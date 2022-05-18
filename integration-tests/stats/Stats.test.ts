import { expect } from "chai";
import { ethers, deployments } from 'hardhat';
import { blockTimestamp } from '../../test/utils/Utils';
import { generateTempusSharesNames, TempusPool } from "../../test/utils/TempusPool";
import { ERC20 } from "../../test/utils/ERC20";
import { ContractBase } from "../../test/utils/ContractBase";
import { decimal } from '../../test/utils/Decimal';
import { EthPriceQuoteProvider } from '../EthPriceQuoteProvider';
import { TempusController } from "../../test/utils/TempusController";
import { describeNonPool } from "../../test/pool-utils/MultiPoolTestSuite";
import { getAccounts } from "../IntegrationUtils";

if (!process.env.HARDHAT_FORK_NUMBER) {
  throw new Error('HARDHAT_FORK_NUMBER env var is not defined');
}
const FORKED_BLOCK_NUMBER = Number(process.env.HARDHAT_FORK_NUMBER);

const setup = deployments.createFixture(async () => {
  await deployments.fixture(undefined, { keepExistingDeployments: true });

  const { owner, holder } = await getAccounts('aWethHolder');

  const Weth = new ERC20("ERC20", 18, (await ethers.getContract("Weth")));
  const aWeth = new ERC20("ERC20", 18, (await ethers.getContract('aToken_Weth')));

  const maturityTime = await blockTimestamp() + 60*60; // maturity is in 1hr
  const names = generateTempusSharesNames("Aave wrapped ether", "aWETH", maturityTime);
  const yieldEst = 0.1;
  const controller = await TempusController.deploy(owner);
  const tempusPool = await TempusPool.deployAave(
    owner, Weth, aWeth, controller, maturityTime, yieldEst, names
  );

  const stats = await ContractBase.deployContract("Stats");
  return { contracts: { tempusPool, controller, aWeth, stats }, signers: { aWethHolder: holder } };
});

describeNonPool('Stats <> Chainlink', () => {
  it('verifies querying the TVL of a pull in USD denominations returns a correct result', async () => {
    // arrange
    const { signers: { aWethHolder }, contracts: { aWeth, controller, tempusPool, stats }} = await setup();
    const depositAmount = 1234.56789;

    // https://docs.chain.link/docs/ethereum-addresses/
    const chainlinkAggregatorNode = "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419"; 

    const currentBlockDate = new Date(1000 * (await ethers.provider.getBlock(FORKED_BLOCK_NUMBER)).timestamp);
    const ethPriceQuote = await EthPriceQuoteProvider.getDailyQuote(currentBlockDate);

    // act
    await aWeth.approve(aWethHolder, tempusPool.address, depositAmount);
    await controller.depositYieldBearing(aWethHolder, tempusPool, depositAmount, aWethHolder);

    // assert
    const totalValueLockedInUSD = +decimal(await stats.totalValueLockedAtGivenRate(tempusPool.address, chainlinkAggregatorNode));
    const minExpectedTVLInUSD = +decimal(depositAmount).mul(ethPriceQuote.low);
    const maxExpectedTVLInUSD = +decimal(depositAmount).mul(ethPriceQuote.high);
    expect(totalValueLockedInUSD).to.be.within(minExpectedTVLInUSD, maxExpectedTVLInUSD);
  });
});
