# **Writing A Custom Adapter for TempusPool**
This is a short checklist on how to adapt an existing lending protocol with Tempus. After the adapter is completed, TempusPool will be able to deposit to and withdraw from the underlying protocol. In this example we use an imaginary lending pool named `MyLending`.  

Code style should follow existing Solidity contracts and existing TypeScript testing utilities should be used. There is an extensive testing suite which automatically generates a new test suite for any defined Pool+Token pair.
#
### 1. **Create an adapter for TempusPool**
This provides all the necessary conversions from `MyLending` protocol to TempusPool.  
Naming Convention: `MyLendingTempusPool`  
Path: `contracts/pools/MyLendingTempusPool.sol`  
Example: [contracts/pools/AaveTempusPool.sol](contracts/pools/AaveTempusPool.sol) and [contracts/pools/YearnTempusPool.sol](contracts/pools/YearnTempusPool.sol)  

1. `constructor()` [contracts/TempusPool.sol#L75](contracts/TempusPool.sol#L75)  
  The `MyLendingTempusPool` constructor must adapt `MyLending` parameters into TempusPool parameters. This means calculating the initial interest rate and initializing the adapter state immutables.
1. `depositToUnderlying()` [contracts/TempusPool.sol#L156](contracts/TempusPool.sol#L156)  
  Implement depositing BackingTokens into `MyLending` pool and return amount of minted YieldBearingTokens.
1. `withdrawFromUnderlyingProtocol()` [contracts/TempusPool.sol#L187](contracts/TempusPool.sol#L187)  
  Implement withdrawing YieldBearingTokens from `MyLending` pool and return amount of BackingTokens received.
1. `updateInterestRate()` [contracts/ITempusPool.sol#L287](contracts/ITempusPool.sol#L287)  
  Implement getting latest interest rate from `MyLending` pool. This exchange rate represents conversion from YieldBearingTokens to BackingTokens. The decimals precision can vary, and this rate is passed back to the adapter at later points.  
1. `currentInterestRate()` [contracts/ITempusPool.sol#L292](contracts/ITempusPool.sol#L292)  
  Implement stored interest rate. The rate should be equal with previous call to `updateInterestRate()`, but for some protocols the implementation is identical to `updateInterestRate()`.
1. `numAssetsPerYieldToken()` [contracts/ITempusPool.sol#L322](contracts/ITempusPool.sol#L322)  
  Convert YieldBearingTokens into BackingTokens amount using the current rate. For some protocols with BT pegged 1:1 with YBT, this is a no-op. For a conversion example, inspect [contracts/pools/YearnTempusPool.sol#L88](contracts/pools/YearnTempusPool.sol#L88)  
1. `numYieldTokensPerAsset()` [contracts/ITempusPool.sol#L329](contracts/ITempusPool.sol#L329)  
  Convert BackingTokens into YieldBearingTokens amount using the current rate. For some protocols with BT pegged 1:1 with YBT, this is a no-op. For a conversion example, inspect [contracts/pools/YearnTempusPool.sol#L92](contracts/pools/YearnTempusPool.sol#L92)  
1. `interestRateToSharePrice()` [contracts/TempusPool.sol#L619](contracts/TempusPool.sol#L619)  
  Convert from interest rate decimal into CapitalShare / YieldShare decimal. For some protocols this is a no-op. For others we recommend storing the conversion rate into an immutable field initialized during construction (AaveTempusPool).

#
### 2. **Create a mock contract `MyLendingMock.sol` for the target protocol**
This will later be used for unit testing via `MyLendingTestPool.ts`  
Path: `contracts/mocks/mylending/MyLendingMock.sol`  
Example: [contracts/mocks/aave/AavePoolMock.sol](contracts/mocks/aave/AavePoolMock.sol)  
#
### 3. **Create a typescript wrapper `MyLendingMock.ts`**
This is needed for `MyLendingTestPool.ts` to be able to modify the mock contract.   
Technically this step can be skipped if you integrate all of this in `MyLendingTestPool.ts`.  
Path: `test/utils/MyLending.ts`  
Example: [test/utils/Aave.ts](test/utils/Aave.ts)  
#
### 4. **Add TestPool implementation `MyLendingTestPool.ts` to enable Unit Tests**
Path: `test/pool-utils/MyLendingTestPool.ts`  
Example: [test/pool-utils/AaveTestPool.ts](test/pool-utils/AaveTestPool.ts)  
#
### 5. **Update TestPool initialization**
TestPools are generated from Pool+Token pairs in [test/pool-utils/MultiPoolTestSuite.ts](test/pool-utils/MultiPoolTestSuite.ts) and
`describeTestBody` is where TestPool instances are created. Create a new instance of your `MyLendingTestPool` there.  
#
### 6. **Update [test/utils/TempusPool.ts](test/utils/TempusPool.ts) to support the new integration**
TempusPool utility also needs to know how to deploy a new instance of `MyLendingTempusPool` contract.
  - Add new PoolType: `PoolType.MyLending`
  - Add a deployment utility: `static async deployMyLending(...)`
  - Update `deploy()` to run the `MyLendingTempusPool` constructor, every adapter has its own constructor
#
### 7. **Update Token information in [test/Config.ts](test/Config.ts)**
You must define exactly what types of tokens are supported in `MOCK_TOKENS`, these are used to generate full test suite for the Pool-Token pair.
#
### 8. **Update test runner script [run_tests.sh](run_tests.sh)**
This is needed to run all tests in parallel, otherwise generated unit test combinations would take forever to run.
  - Append your adapter into `POOLS` variable: `POOLS="Aave Lido Compound Yearn MyLending"`
  - Define which tokens the pool supports: `POOL_TOKENS["MyLending"]="DAI SHIB"`
  - If needed, update `VALID_TOKENS` `VALID_TOKENS="DAI USDC ETH SHIB all"`
#
### 9. **Run the tests**
  - The default command to run all tests is `yarn test`
  - You can add `test:mylending` rule in `package.json` to only run MyLending tests:  
    `"test:mylending": "yarn build && bash run_tests.sh MyLending"`
  - Or only use a specific token:  
    `"test:mylending": "yarn build && bash run_tests.sh MyLending SHIB"`
#
