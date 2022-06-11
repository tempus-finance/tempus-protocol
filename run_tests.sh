#!/bin/bash

# Load env vars from .env file
if [ -f .env ]; then
  source .env
fi

TESTS_PATH=""
HARDHAT_FORK="mainnet"
HARDHAT_FORK_NUMBER="13281002"
ENVS=""
PARALLEL=true
# not all progress reporters work well with multi-process output
# those that cache results in a single file are the worst
REPORTER="progress"
ONLY_TOKEN=""
ONLY_POOL=""
VALID_TOKENS="DAI USDC ETH all"
POOLS="None Aave Lido Compound Yearn"
# @see test/Config.ts
declare -A POOL_TOKENS
POOL_TOKENS["None"]=""
POOL_TOKENS["Aave"]="DAI USDC"
POOL_TOKENS["Lido"]="ETH"
POOL_TOKENS["Compound"]="DAI USDC"
POOL_TOKENS["Yearn"]="DAI USDC"

if [ -z "$ETH_NODE_URI_MAINNET" ]; then
  echo "env var ETH_NODE_URI_MAINNET was not set! It is required to run the test suite"
  exit -1
fi

# parse args
while [ -n "$1" ]; do
  if [ "$1" == "integration-suite" ]; then # integration suite test
    ENVS="$ENVS INTEGRATION=1 ETH_NODE_URI_MAINNET=$ETH_NODE_URI_MAINNET"
    ENVS="$ENVS HARDHAT_FORK=$HARDHAT_FORK HARDHAT_FORK_NUMBER=$HARDHAT_FORK_NUMBER "

  elif [ "$1" == "integration-tests" ]; then # use integration-tests folder
    ENVS="$ENVS INTEGRATION=1 ETH_NODE_URI_MAINNET=$ETH_NODE_URI_MAINNET"
    ENVS="$ENVS HARDHAT_FORK=$HARDHAT_FORK HARDHAT_FORK_NUMBER=$HARDHAT_FORK_NUMBER "
    TESTS_PATH="integration-tests"
    ONLY_TOKEN="all" # handle all tokens in a single process instead of spawning multiple

  elif [ "$1" == "no-parallel" ]; then # disable parallelization
    PARALLEL=false
  elif [[ "$POOLS" =~ "$1" ]]; then # only pool
    ONLY_POOL="$1"
  elif [[ "$VALID_TOKENS" =~ "$1" ]]; then # only token
    ONLY_TOKEN="$1"
  fi
  shift
done

if [ "$ONLY_POOL" ] && [[ "$ONLY_POOL" == "None" || "$ONLY_TOKEN" ]]; then
  REPORTER="spec"
fi

CMD="npx mocha --require hardhat/register --timeout 120000 --recursive --extension ts --reporter $REPORTER $TESTS_PATH"

pools="$POOLS"
if [ "$ONLY_POOL" ]; then
  pools="$ONLY_POOL"
fi

start_time=$(date +%s)

if [ "$PARALLEL" == "true" ]; then
  PIDS=()
  for pool in $pools; do
    tokens=${POOL_TOKENS[$pool]}
    if [ "$ONLY_TOKEN" ]; then
      if [[ "$VALID_TOKENS" =~ "$ONLY_TOKEN" ]]; then
        tokens="$ONLY_TOKEN"
      else # ONLY_TOKEN is not a valid token for this pool
        echo Skipping $ONLY_TOKEN for $pool - $ONLY_TOKEN
        continue
      fi
    fi
    for token in $tokens; do
      echo Start Parallel Test $pool - $token
      cross-env ONLY_POOL=$pool ONLY_TOKEN=$token $ENVS $CMD &
      PIDS+=($!)
    done
  done

  # and finally run the non-pool tests, only if we haven't set ONLY_POOL or ONLY_TOKEN
  if [[ "$ONLY_POOL" == "" || "$ONLY_POOL" == "None" ]] && [ "$ONLY_TOKEN" == "" ]; then
    echo Start Tests Non-Pool
    cross-env ONLY_POOL=None $ENVS $CMD &
    PIDS+=($!)
  fi

  # wait for results and check for failure
  FAILS=0
  TOTAL=0
  for pid in "${PIDS[@]}"; do
    let "TOTAL+=1"
    wait $pid || let "FAILS+=1"
  done
else
  FAILS=0
  TOTAL=1
  echo Start Unparallelized Test $ONLY_POOL - $ONLY_TOKEN
  cross-env ONLY_POOL=$ONLY_POOL ONLY_TOKEN=$ONLY_TOKEN $ENVS $CMD
fi

end_time=$(date +%s)
elapsed=$(( end_time - start_time ))
echo ""
echo elapsed time: $(date -ud "@$elapsed" +'%M min %S sec')

if [ "$FAILS" != "0" ]; then
  echo "$FAILS / $TOTAL test runners failed"
  exit 1
fi
