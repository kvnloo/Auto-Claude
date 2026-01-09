#!/bin/bash
# Test script for verifying terminal debouncing implementation
# This script generates various high-frequency output scenarios to test performance

set -e

echo "================================================================"
echo "Terminal Debouncing Performance Test Suite"
echo "================================================================"
echo ""
echo "This script will run multiple test scenarios that generate"
echo "high-frequency terminal output to verify the debouncing works."
echo ""

# Color codes for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test 1: Rapid echo loop (simple test)
test_rapid_echo() {
  echo -e "${BLUE}[Test 1/7] Rapid echo loop (100 lines)${NC}"
  echo "Expected: Smooth output without lag"
  echo "---"
  for i in {1..100}; do
    echo "Line $i - Testing terminal write debouncing performance"
  done
  echo -e "${GREEN}✓ Test 1 completed${NC}"
  echo ""
}

# Test 2: Large output burst
test_large_burst() {
  echo -e "${BLUE}[Test 2/7] Large output burst (1000 lines)${NC}"
  echo "Expected: Fast rendering without blocking UI"
  echo "---"
  for i in {1..1000}; do
    echo "Burst line $i"
  done
  echo -e "${GREEN}✓ Test 2 completed${NC}"
  echo ""
}

# Test 3: Output with ANSI colors
test_ansi_colors() {
  echo -e "${BLUE}[Test 3/7] ANSI color codes (100 colored lines)${NC}"
  echo "Expected: Colors render correctly without corruption"
  echo "---"
  for i in {1..100}; do
    echo -e "\033[3$((i % 8))mColored line $i\033[0m"
  done
  echo -e "${GREEN}✓ Test 3 completed${NC}"
  echo ""
}

# Test 4: Mixed short and long lines
test_mixed_lines() {
  echo -e "${BLUE}[Test 4/7] Mixed line lengths${NC}"
  echo "Expected: All content visible, no truncation"
  echo "---"
  for i in {1..50}; do
    if [ $((i % 3)) -eq 0 ]; then
      echo "Short $i"
    else
      echo "This is a much longer line $i with more content to test buffer handling and ensure data integrity across varying line lengths"
    fi
  done
  echo -e "${GREEN}✓ Test 4 completed${NC}"
  echo ""
}

# Test 5: Unicode and emoji
test_unicode() {
  echo -e "${BLUE}[Test 5/7] Unicode and emoji support${NC}"
  echo "Expected: All characters render correctly"
  echo "---"
  for i in {1..50}; do
    echo "Line $i: 🚀 Testing emoji 🎉 and unicode ñ á é í ó ú 中文 日本語 한국어"
  done
  echo -e "${GREEN}✓ Test 5 completed${NC}"
  echo ""
}

# Test 6: Progress bar simulation
test_progress_bar() {
  echo -e "${BLUE}[Test 6/7] Progress bar simulation (rapid updates)${NC}"
  echo "Expected: Smooth progress animation"
  echo "---"
  for i in {1..100}; do
    printf "\rProgress: [%-50s] %d%%" $(printf '#%.0s' $(seq 1 $((i/2)))) $i
    sleep 0.01
  done
  echo ""
  echo -e "${GREEN}✓ Test 6 completed${NC}"
  echo ""
}

# Test 7: Simulated npm install output
test_npm_simulation() {
  echo -e "${BLUE}[Test 7/7] Simulated npm install output${NC}"
  echo "Expected: Fast rendering of package install messages"
  echo "---"

  packages=(
    "react" "react-dom" "typescript" "webpack" "babel-core"
    "eslint" "prettier" "jest" "lodash" "axios"
    "@types/react" "@types/node" "express" "next" "vite"
  )

  for pkg in "${packages[@]}"; do
    echo -e "\033[2K\033[0G⠋ Installing ${pkg}..."
    for i in {1..10}; do
      echo "  ├─ dependency-${pkg}-${i}@1.0.${i}"
    done
    echo -e "\033[32m✓\033[0m ${pkg}@latest installed"
  done

  echo -e "${GREEN}✓ Test 7 completed${NC}"
  echo ""
}

# Run all tests
main() {
  echo -e "${YELLOW}Starting test suite...${NC}"
  echo ""

  test_rapid_echo
  sleep 1

  test_large_burst
  sleep 1

  test_ansi_colors
  sleep 1

  test_mixed_lines
  sleep 1

  test_unicode
  sleep 1

  test_progress_bar
  sleep 1

  test_npm_simulation

  echo "================================================================"
  echo -e "${GREEN}All tests completed successfully!${NC}"
  echo "================================================================"
  echo ""
  echo "Manual verification checklist:"
  echo "  □ Terminal output was smooth without lag"
  echo "  □ Colors rendered correctly"
  echo "  □ Unicode/emoji displayed properly"
  echo "  □ No data loss or corruption"
  echo "  □ UI remained responsive during output"
  echo "  □ Scrolling performance was good"
  echo ""
  echo "Next steps:"
  echo "  1. Check browser DevTools Performance tab"
  echo "  2. Verify React re-renders are reduced"
  echo "  3. Compare with pre-debouncing baseline if available"
  echo ""
}

# Run main function
main
