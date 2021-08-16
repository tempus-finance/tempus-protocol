
# Tempus Protocol

Smart contracts of Tempus Finance

[![Coverage Status](https://coveralls.io/repos/github/tempus-finance/tempus-protocol/badge.svg?branch=master&t=3oDH6q)](https://coveralls.io/github/tempus-finance/tempus-protocol?branch=master)


## Compiling and running tests

Installing dependancies `yarn install`

To compile run `npx hardhat compile`

To run the unit tests `yarn test`

To run the integration tests `yarn test:integration` (check prerequisites [here](#integration-tests))

  

## Coding style

Please follow suggested coding style from solidity language documentation. It can be found at https://docs.soliditylang.org/en/latest/style-guide.html

  
  

## Testing

### Unit Tests
To run unit tests, simply execute `yarn test`.

### Integration Tests
Our integration tests run against a local network that is forked off of the Ethereum Mainnet. Follow these steps to run them:

* Set the `ETH_NODE_URI_MAINNET` environment variable to an archive mainnet Ethereum node URI.
* Execute `yarn test:integration`. 