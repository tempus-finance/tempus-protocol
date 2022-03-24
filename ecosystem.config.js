module.exports = {
  apps : [{
    script: 'cross-env HARDHAT_FORK=mainnet npx hardhat node',
    cwd: '/home/ubuntu/tempus-protocol',
    env: {
      "ETH_NODE_URI_MAINNET": 'https://eth-mainnet.alchemyapi.io/v2/HoSM3yYpLsw2TRBlBvZKIdB5vu9jThn8',
    }
  }]
};
