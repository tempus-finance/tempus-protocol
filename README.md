# Tempus Protocol

Smart contracts of Tempus Finance

[![Coverage Status](https://coveralls.io/repos/github/tempus-finance/tempus-protocol/badge.svg?branch=master&t=3oDH6q&kill_cache=1)](https://coveralls.io/github/tempus-finance/tempus-protocol?branch=master)

## Compiling and running tests

Installing dependancies `yarn install`

To compile run `yarn build`

To run the unit tests `yarn test`

To run the integration tests `yarn test:integration` (check prerequisites [here](#integration-tests))

## Coding style

Please follow suggested coding style from solidity language documentation. It can be found at https://docs.soliditylang.org/en/latest/style-guide.html

## Testing

### Unit Tests

To run unit tests, simply execute `yarn test`.

### Integration Tests

Our integration tests run against a local network that is forked off of the Ethereum Mainnet. Follow these steps to run them:

- Set the `ETH_NODE_URI_MAINNET` environment variable to an archive mainnet Ethereum node URI.
- Execute `yarn test:integration`.

## Running locally

# Set env variable

Set `ETH_NODE_URI_MAINNET` to `https://eth-mainnet.alchemyapi.io/v2/<AlchemyKey>`

# Run Mainnet

Run `yarn run start-local:fork:mainnet`

# Deploy local pools

In another terminal run `yarn run deploy-local:fork:mainnet`. It may fail due to network error, so please try until it works.
-Once done, it generates 2 cookie configs: AWS and Local.

- copy the local value (`javascript:(function() {document.cookie = "TEMPUS_OVERRIDING_CONFIG=....})()`)
- in Chrome open Bookmarks and then Bookmark Manager
- Click 3 dots and Add new bookmark
- Name can be anything, for example `Mainnet fork`
- In the URL field paste the value copied earlier
- once the client is running, go to Bookmarks and select `Mainnet fork`

# Set MetaMask

- set up MetaMask chain id to `31337` and URL to `http://127.0.0.1:8545/`
- to get tokens in MetaMask`yarn run deposit-local:fork:mainnet`
- add tokens to MetaMask if not present
