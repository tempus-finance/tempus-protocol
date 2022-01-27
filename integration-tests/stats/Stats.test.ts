import { expect } from "chai";
import {
  ethers,
  deployments,
  getNamedAccounts
} from 'hardhat';
import { BigNumber } from '@ethersproject/bignumber';
import * as NameHash from 'eth-ens-namehash';
import { blockTimestamp } from '../../test/utils/Utils';
import { generateTempusSharesNames, TempusPool } from "../../test/utils/TempusPool";
import { ERC20 } from "../../test/utils/ERC20";
import { ContractBase } from "../../test/utils/ContractBase";
import { toWei } from '../../test/utils/Decimal';
import { EthPriceQuoteProvider } from '../EthPriceQuoteProvider';
import { TempusController } from "../../test/utils/TempusController";

if (!process.env.HARDHAT_FORK_NUMBER) {
  throw new Error('HARDHAT_FORK_NUMBER env var is not defined');
}
const FORKED_BLOCK_NUMBER = Number(process.env.HARDHAT_FORK_NUMBER);

const setup = deployments.createFixture(async () => {
  await deployments.fixture(undefined, {
    keepExistingDeployments: true, // global option to test network like that
  });

  const owner = (await ethers.getSigners())[0];
  const { aWethHolder } = await getNamedAccounts();
  
  const aWethHolderSigner = await ethers.getSigner(aWethHolder);
  
  const Weth = new ERC20("ERC20", 18, (await ethers.getContract("Weth")));
  const aWethYieldToken = new ERC20("ERC20", 18, (await ethers.getContract('aToken_Weth')));
  
  const maturityTime = await blockTimestamp() + 60*60; // maturity is in 1hr

  const names = generateTempusSharesNames("Aave wrapped ether", "aWETH", maturityTime);
  const yieldEst = 0.1;
  const controller = await TempusController.deploy(owner);
  const tempusPool = await TempusPool.deployAave(
    owner, Weth, aWethYieldToken, controller, maturityTime, yieldEst, names
  );
  
  const stats = await ContractBase.deployContract("Stats");

  return {
    contracts: {
      tempusPool,
      controller,
      aWeth: aWethYieldToken,
      stats
    },
    signers: {
      aWethHolder: aWethHolderSigner
    }
  };
});

describe('Stats <> Chainlink', function () {
  it('verifies querying the TVL of a pull in USD denominations returns a correct result', async () => {
    // arrange
    const { signers: { aWethHolder }, contracts: { aWeth, controller, tempusPool, stats }} = await setup();
    const depositAmount: number = 1234.56789;
    
    // https://docs.chain.link/docs/ethereum-addresses/
    const chainlinkAggregatorNode = "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419"; 

    const currentBlockDate = new Date(1000 * (await ethers.provider.getBlock(FORKED_BLOCK_NUMBER)).timestamp);
    const ethPriceQuote = await EthPriceQuoteProvider.getDailyQuote(currentBlockDate);
    
    // act
    await aWeth.approve(aWethHolder, tempusPool.address, depositAmount);
    await controller.depositYieldBearing(aWethHolder, tempusPool, depositAmount, aWethHolder);
    
    // assert
    const totalValueLockedInUSD :BigNumber = await stats.totalValueLockedAtGivenRate(tempusPool.address, chainlinkAggregatorNode);
    const minExpectedTotalValueLockedInUSD = Number(toWei(depositAmount).mul(toWei(ethPriceQuote.low)).div(toWei(1)));
    const maxExpectedTotalValueLockedInUSD = Number(toWei(depositAmount).mul(toWei(ethPriceQuote.high)).div(toWei(1)));

    expect(Number(totalValueLockedInUSD)).to.be.within(minExpectedTotalValueLockedInUSD, maxExpectedTotalValueLockedInUSD);
  });
})
