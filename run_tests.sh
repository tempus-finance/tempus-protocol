#!/usr/bin/bash

TESTS_PATH=""
ETH_NODE_URI_MAINNET="https://eth-mainnet.alchemyapi.io/v2/yInmJCdHvCzXe4qAxfPMDFgrbYIGsUhJ"
HARDHAT_FORK="mainnet"
HARDHAT_FORK_NUMBER="13281002"
RUN=""
ENVS=""
# not all progress reporters work well with multi-process output
# those that cache results in a single file are the worst
REPORTER="progress"
ONLY_TOKEN=""
ONLY_POOL=""
TOKENS="DAI USDC ETH"
POOLS="Aave Lido Compound Yearn Rari"
# @see test/Config.ts
declare -A POOL_TOKENS
POOL_TOKENS["Aave"]="DAI USDC"
POOL_TOKENS["Lido"]="ETH"
POOL_TOKENS["Compound"]="DAI USDC"
POOL_TOKENS["Yearn"]="DAI USDC"
POOL_TOKENS["Rari"]="DAI USDC"

# parse args
while [ -n "$1" ]; do
  if [ "$1" == "integration-suite" ]; then # integration suite test
    ENVS="$ENVS INTEGRATION=1 ETH_NODE_URI_MAINNET=$ETH_NODE_URI_MAINNET"
    ENVS="$ENVS HARDHAT_FORK=$HARDHAT_FORK HARDHAT_FORK_NUMBER=$HARDHAT_FORK_NUMBER "

  elif [ "$1" == "integration-tests" ]; then # use integration-tests folder
    ENVS="$ENVS INTEGRATION=1 ETH_NODE_URI_MAINNET=$ETH_NODE_URI_MAINNET"
    ENVS="$ENVS HARDHAT_FORK=$HARDHAT_FORK HARDHAT_FORK_NUMBER=$HARDHAT_FORK_NUMBER "
    TESTS_PATH="integration-tests"
    ONLY_POOL="all"
    REPORTER="spec"

  elif [[ "$POOLS" =~ "$1" ]]; then # only pool
    ONLY_POOL="$1"
  elif [[ "$TOKENS" =~ "$1" ]]; then # only token
    ONLY_TOKEN="$1"
  fi
  shift
done

if [ "$ONLY_POOL" ] && [ "$ONLY_TOKEN" ]; then
  REPORTER="spec"
fi

CMD="npx mocha --require hardhat/register --timeout 120000 --recursive --extension ts --reporter $REPORTER $TESTS_PATH"

pools="$POOLS"
if [ "$ONLY_POOL" ]; then
  pools="$ONLY_POOL"
fi

for pool in $pools; do
  tokens=${POOL_TOKENS[$pool]}
  if [ "$ONLY_TOKEN" ]; then
    if [[ "$TOKENS" =~ "$ONLY_TOKEN" ]]; then
      tokens="$ONLY_TOKEN"
    else # ONLY_TOKEN is not a valid token for this pool
      echo Skipping $ONLY_TOKEN for $pool
      continue
    fi
  fi
  for token in $tokens; do
    echo Start Tests $pool - $token
    if [ -n "$RUN" ]; then
      RUN="$RUN &"
    fi
    RUN="$RUN cross-env ONLY_POOL=$pool ONLY_TOKEN=$token $ENVS $CMD"
  done
done

#echo $RUN

start_time=$(date +%s)
eval $RUN
end_time=$(date +%s)
elapsed=$(( end_time - start_time ))
echo elapsed time: $(date -ud "@$elapsed" +'%M min %S sec')