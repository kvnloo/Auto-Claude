"""
Cost Calculator
================

Calculate costs for Claude API usage based on official pricing tiers.

Pricing (as of 2025):
- Claude Sonnet: $3/1M input, $15/1M output
- Claude Opus: $15/1M input, $75/1M output
- Claude Haiku: $0.25/1M input, $1.25/1M output

Key considerations:
- Thinking tokens are billed at output rate
- Cache hits receive 90% discount
- Extended thinking (claude-sonnet-4-5-20250929) has special pricing

Example usage:
    from usage.cost_calculator import CostCalculator
    from usage.models import TokenUsageRecord

    calculator = CostCalculator()

    # Calculate cost for a usage record
    cost = calculator.calculate_cost(record)

    # Get pricing for a model
    pricing = calculator.get_pricing_for_model("claude-sonnet-4-5-20250929")

    # Format for display
    display = calculator.format_cost_display(cost)
"""

from dataclasses import dataclass, field
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Optional

from usage.models import TokenUsageRecord


# Tokens per million (used for price calculation)
TOKENS_PER_MILLION = 1_000_000


@dataclass(frozen=True)
class ModelPricing:
    """
    Pricing configuration for a Claude model.

    Attributes:
        model_family: Model family name (e.g., "sonnet", "opus", "haiku")
        input_price_per_million: Cost per 1M input tokens in USD
        output_price_per_million: Cost per 1M output tokens in USD
        cache_discount: Discount multiplier for cache hits (0.1 = 90% off)
        display_name: Human-readable model name
    """

    model_family: str
    input_price_per_million: Decimal
    output_price_per_million: Decimal
    cache_discount: Decimal = field(default=Decimal("0.1"))  # 90% cheaper
    display_name: str = ""

    def __post_init__(self) -> None:
        # Set display_name if not provided
        if not self.display_name:
            object.__setattr__(self, "display_name", self.model_family.capitalize())


# Official Claude pricing tiers
CLAUDE_PRICING: dict[str, ModelPricing] = {
    "sonnet": ModelPricing(
        model_family="sonnet",
        input_price_per_million=Decimal("3.00"),
        output_price_per_million=Decimal("15.00"),
        display_name="Claude Sonnet",
    ),
    "opus": ModelPricing(
        model_family="opus",
        input_price_per_million=Decimal("15.00"),
        output_price_per_million=Decimal("75.00"),
        display_name="Claude Opus",
    ),
    "haiku": ModelPricing(
        model_family="haiku",
        input_price_per_million=Decimal("0.25"),
        output_price_per_million=Decimal("1.25"),
        display_name="Claude Haiku",
    ),
}

# Default model to use when model cannot be determined
DEFAULT_MODEL_FAMILY = "sonnet"


@dataclass
class CostBreakdown:
    """
    Detailed cost breakdown for a usage calculation.

    Attributes:
        input_cost: Cost for non-cached input tokens
        output_cost: Cost for output tokens (excluding thinking)
        thinking_cost: Cost for thinking tokens (billed at output rate)
        cache_cost: Cost for cache hit tokens (with discount applied)
        total_cost: Total cost (sum of all components)
        model_pricing: The pricing tier used for calculation
        tokens_billed: Dictionary with token counts by type
    """

    input_cost: Decimal
    output_cost: Decimal
    thinking_cost: Decimal
    cache_cost: Decimal
    total_cost: Decimal
    model_pricing: ModelPricing
    tokens_billed: dict[str, int] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            "input_cost": float(self.input_cost),
            "output_cost": float(self.output_cost),
            "thinking_cost": float(self.thinking_cost),
            "cache_cost": float(self.cache_cost),
            "total_cost": float(self.total_cost),
            "model_family": self.model_pricing.model_family,
            "model_display_name": self.model_pricing.display_name,
            "tokens_billed": self.tokens_billed,
        }


class CostCalculator:
    """
    Calculator for Claude API usage costs.

    Handles all cost calculations with support for:
    - Different Claude model tiers (Sonnet, Opus, Haiku)
    - Thinking tokens (billed at output rate)
    - Cache hit savings (90% discount)
    - Custom pricing overrides

    Thread-safe and stateless - can be used across multiple sessions.
    """

    def __init__(
        self,
        custom_pricing: Optional[dict[str, ModelPricing]] = None,
        default_model: str = DEFAULT_MODEL_FAMILY,
    ):
        """
        Initialize the CostCalculator.

        Args:
            custom_pricing: Optional dictionary of custom pricing overrides.
                           Merged with default pricing (custom takes precedence).
            default_model: Model family to use when model cannot be determined.
        """
        self._pricing = {**CLAUDE_PRICING}
        if custom_pricing:
            self._pricing.update(custom_pricing)
        self._default_model = default_model

    def get_pricing_for_model(self, model_name: str) -> ModelPricing:
        """
        Get pricing configuration for a model.

        Extracts the model family from the full model name and returns
        the corresponding pricing tier.

        Args:
            model_name: Full model name (e.g., "claude-sonnet-4-5-20250929")
                       or model family (e.g., "sonnet")

        Returns:
            ModelPricing configuration for the model

        Examples:
            >>> calc = CostCalculator()
            >>> pricing = calc.get_pricing_for_model("claude-sonnet-4-5-20250929")
            >>> pricing.model_family
            'sonnet'
            >>> pricing = calc.get_pricing_for_model("opus")
            >>> pricing.input_price_per_million
            Decimal('15.00')
        """
        model_family = self._extract_model_family(model_name)
        return self._pricing.get(model_family, self._pricing[self._default_model])

    def calculate_cost(
        self,
        record: TokenUsageRecord,
        return_breakdown: bool = False,
    ) -> Decimal | CostBreakdown:
        """
        Calculate the cost for a token usage record.

        Computes cost based on:
        - Input tokens (minus cache hits) at input rate
        - Output tokens at output rate
        - Thinking tokens at output rate (billed as output)
        - Cache hit tokens at discounted input rate (90% off)

        Args:
            record: TokenUsageRecord with token counts
            return_breakdown: If True, return detailed CostBreakdown instead
                            of just the total cost

        Returns:
            Total cost as Decimal, or CostBreakdown if return_breakdown=True
        """
        pricing = self.get_pricing_for_model(record.model_name)

        # Calculate input tokens (excluding cache hits)
        non_cached_input = max(0, record.input_tokens - record.cache_hit_tokens)

        # Calculate costs using Decimal for precision
        input_cost = self._calculate_token_cost(
            non_cached_input, pricing.input_price_per_million
        )
        output_cost = self._calculate_token_cost(
            record.output_tokens, pricing.output_price_per_million
        )
        thinking_cost = self._calculate_token_cost(
            record.thinking_tokens, pricing.output_price_per_million
        )

        # Cache hits are charged at discounted rate
        cache_cost = self._calculate_token_cost(
            record.cache_hit_tokens,
            pricing.input_price_per_million * pricing.cache_discount,
        )

        total_cost = input_cost + output_cost + thinking_cost + cache_cost

        if return_breakdown:
            return CostBreakdown(
                input_cost=input_cost,
                output_cost=output_cost,
                thinking_cost=thinking_cost,
                cache_cost=cache_cost,
                total_cost=total_cost,
                model_pricing=pricing,
                tokens_billed={
                    "input_tokens": non_cached_input,
                    "output_tokens": record.output_tokens,
                    "thinking_tokens": record.thinking_tokens,
                    "cache_hit_tokens": record.cache_hit_tokens,
                },
            )

        return total_cost

    def calculate_cost_from_tokens(
        self,
        model_name: str,
        input_tokens: int = 0,
        output_tokens: int = 0,
        thinking_tokens: int = 0,
        cache_hit_tokens: int = 0,
    ) -> Decimal:
        """
        Calculate cost from raw token counts.

        Convenience method when you have token counts but not a full record.

        Args:
            model_name: Model name or family
            input_tokens: Total input tokens (including cache hits)
            output_tokens: Output tokens generated
            thinking_tokens: Extended thinking tokens
            cache_hit_tokens: Tokens served from cache

        Returns:
            Total cost as Decimal
        """
        pricing = self.get_pricing_for_model(model_name)

        # Calculate non-cached input tokens
        non_cached_input = max(0, input_tokens - cache_hit_tokens)

        # Calculate each cost component
        input_cost = self._calculate_token_cost(
            non_cached_input, pricing.input_price_per_million
        )
        output_cost = self._calculate_token_cost(
            output_tokens, pricing.output_price_per_million
        )
        thinking_cost = self._calculate_token_cost(
            thinking_tokens, pricing.output_price_per_million
        )
        cache_cost = self._calculate_token_cost(
            cache_hit_tokens,
            pricing.input_price_per_million * pricing.cache_discount,
        )

        return input_cost + output_cost + thinking_cost + cache_cost

    def calculate_batch_cost(
        self,
        records: list[TokenUsageRecord],
    ) -> Decimal:
        """
        Calculate total cost for multiple usage records.

        Args:
            records: List of TokenUsageRecord objects

        Returns:
            Total cost for all records as Decimal
        """
        total = Decimal("0")
        for record in records:
            total += self.calculate_cost(record)
        return total

    def estimate_cost(
        self,
        model_name: str,
        estimated_input_tokens: int,
        estimated_output_tokens: int,
        estimated_thinking_tokens: int = 0,
        estimated_cache_hit_rate: float = 0.0,
    ) -> Decimal:
        """
        Estimate cost for a future session.

        Useful for pre-flight cost estimation based on expected usage.

        Args:
            model_name: Model name or family to use
            estimated_input_tokens: Expected input tokens
            estimated_output_tokens: Expected output tokens
            estimated_thinking_tokens: Expected thinking tokens
            estimated_cache_hit_rate: Expected cache hit rate (0.0 to 1.0)

        Returns:
            Estimated cost as Decimal
        """
        # Calculate cache hits based on rate
        cache_hit_tokens = int(estimated_input_tokens * estimated_cache_hit_rate)

        return self.calculate_cost_from_tokens(
            model_name=model_name,
            input_tokens=estimated_input_tokens,
            output_tokens=estimated_output_tokens,
            thinking_tokens=estimated_thinking_tokens,
            cache_hit_tokens=cache_hit_tokens,
        )

    def format_cost_display(
        self,
        cost: Decimal | float,
        precision: int = 4,
        include_symbol: bool = True,
        abbreviate: bool = False,
    ) -> str:
        """
        Format a cost value for display.

        Args:
            cost: Cost value to format
            precision: Number of decimal places (default: 4)
            include_symbol: Whether to include "$" symbol (default: True)
            abbreviate: Whether to abbreviate large values (e.g., $1.2K)

        Returns:
            Formatted cost string (e.g., "$0.0234", "$1.23K")

        Examples:
            >>> calc = CostCalculator()
            >>> calc.format_cost_display(Decimal("0.0234"))
            '$0.0234'
            >>> calc.format_cost_display(1234.56, abbreviate=True)
            '$1.23K'
            >>> calc.format_cost_display(0.05, precision=2, include_symbol=False)
            '0.05'
        """
        if not isinstance(cost, Decimal):
            cost = Decimal(str(cost))

        # Handle abbreviations for large values
        if abbreviate and cost >= 1000:
            if cost >= 1_000_000:
                value = cost / Decimal("1000000")
                suffix = "M"
            elif cost >= 1000:
                value = cost / Decimal("1000")
                suffix = "K"
            else:
                value = cost
                suffix = ""

            # Use fewer decimal places for abbreviated values
            formatted = f"{float(value):.2f}{suffix}"
        else:
            # Round to specified precision
            quantize_str = "0." + "0" * precision
            rounded = cost.quantize(Decimal(quantize_str), rounding=ROUND_HALF_UP)
            formatted = f"{float(rounded):.{precision}f}"

        if include_symbol:
            return f"${formatted}"
        return formatted

    def format_cost_breakdown(
        self,
        breakdown: CostBreakdown,
        include_zeros: bool = False,
    ) -> str:
        """
        Format a cost breakdown for detailed display.

        Args:
            breakdown: CostBreakdown to format
            include_zeros: Whether to include zero-cost components

        Returns:
            Multi-line formatted string with cost breakdown
        """
        lines = [
            f"Model: {breakdown.model_pricing.display_name}",
            f"Total: {self.format_cost_display(breakdown.total_cost)}",
            "",
            "Breakdown:",
        ]

        components = [
            ("Input", breakdown.input_cost, breakdown.tokens_billed.get("input_tokens", 0)),
            ("Output", breakdown.output_cost, breakdown.tokens_billed.get("output_tokens", 0)),
            ("Thinking", breakdown.thinking_cost, breakdown.tokens_billed.get("thinking_tokens", 0)),
            ("Cache hits", breakdown.cache_cost, breakdown.tokens_billed.get("cache_hit_tokens", 0)),
        ]

        for name, cost, tokens in components:
            if cost > 0 or include_zeros:
                lines.append(
                    f"  {name}: {self.format_cost_display(cost)} ({tokens:,} tokens)"
                )

        return "\n".join(lines)

    def get_available_models(self) -> list[str]:
        """
        Get list of available model families.

        Returns:
            List of model family names
        """
        return list(self._pricing.keys())

    def get_all_pricing(self) -> dict[str, dict[str, Any]]:
        """
        Get all pricing information.

        Returns:
            Dictionary of model families to their pricing details
        """
        return {
            family: {
                "model_family": pricing.model_family,
                "display_name": pricing.display_name,
                "input_price_per_million": float(pricing.input_price_per_million),
                "output_price_per_million": float(pricing.output_price_per_million),
                "cache_discount": float(pricing.cache_discount),
            }
            for family, pricing in self._pricing.items()
        }

    def _extract_model_family(self, model_name: str) -> str:
        """
        Extract model family from full model name.

        Args:
            model_name: Full model name or family

        Returns:
            Model family (e.g., "sonnet", "opus", "haiku")
        """
        model_lower = model_name.lower()

        # Check for exact match first
        if model_lower in self._pricing:
            return model_lower

        # Check for model family in name
        for family in self._pricing:
            if family in model_lower:
                return family

        # Return default if no match
        return self._default_model

    def _calculate_token_cost(
        self,
        token_count: int,
        price_per_million: Decimal,
    ) -> Decimal:
        """
        Calculate cost for a token count at a given price.

        Args:
            token_count: Number of tokens
            price_per_million: Price per million tokens

        Returns:
            Cost as Decimal with full precision
        """
        if token_count <= 0:
            return Decimal("0")

        return (Decimal(token_count) * price_per_million) / Decimal(TOKENS_PER_MILLION)


# Singleton instance for convenience
_default_calculator: Optional[CostCalculator] = None


def get_cost_calculator() -> CostCalculator:
    """
    Get the default CostCalculator instance.

    Returns:
        Shared CostCalculator instance
    """
    global _default_calculator
    if _default_calculator is None:
        _default_calculator = CostCalculator()
    return _default_calculator


def calculate_cost(record: TokenUsageRecord) -> float:
    """
    Convenience function to calculate cost for a usage record.

    Args:
        record: TokenUsageRecord with token counts

    Returns:
        Total cost as float
    """
    return float(get_cost_calculator().calculate_cost(record))


def format_cost(cost: float, precision: int = 4) -> str:
    """
    Convenience function to format a cost value.

    Args:
        cost: Cost value to format
        precision: Number of decimal places

    Returns:
        Formatted cost string
    """
    return get_cost_calculator().format_cost_display(cost, precision=precision)
