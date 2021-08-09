// External libraries
import { ethers, network, getNamedAccounts } from 'hardhat';

// Test Utils
import { ERC20 } from '../test/utils/ERC20';
import { TempusPool } from '../test/utils/TempusPool';
import { IPriceOracle } from '../test/utils/IPriceOracle';
import { ContractBase } from '../test/utils/ContractBase';

class DeployLocalForked {
  static readonly SECONDS_IN_A_DAY = 86400;

  static async deploy() {
    const aDaiToken = new ERC20("ERC20", (await ethers.getContract('aToken_Dai')));
  
    const latestBlock = await ethers.provider.getBlock('latest');
    console.log(`Latest block number: ${latestBlock.number}`);
  
    // Deploy Aave price oracle contract
    const priceOracle = await IPriceOracle.deploy("AavePriceOracle");
  
    // Deploy Tempus pool backed by Aave (aDAI Token)
    const tempusPool = await TempusPool.deploy(aDaiToken, priceOracle, latestBlock.timestamp + this.SECONDS_IN_A_DAY * 365);

    // Deploy stats contract
    const statistics = await ContractBase.deployContract("Stats");

    // Make deposit into pool to increase pool TVL
    const { aDaiHolder } = await getNamedAccounts();
    await this.makeDeposit(1000, tempusPool, aDaiHolder, aDaiToken);
  
    // Log required information to console.
    console.log(`Deployed TempusPool contract at: ${tempusPool.address}`);
    console.log(`TPS deployed at: ${tempusPool.principalShare.address}`)
    console.log(`TYS deployed at: ${tempusPool.yieldShare.address}`);
    console.log(`YBT address: ${tempusPool.yieldBearing.address}`);
    console.log(`Deployed AavePriceOracle contract at: ${priceOracle.address}`);
    console.log(`Deployed Statistics contract at: ${statistics.address}`);
  }

  static async makeDeposit(amount: number, pool: TempusPool, from: string, token: ERC20) {
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [from],
    });
    const fromSigner = await ethers.getSigner(from);
  
    await token.approve(fromSigner, fromSigner, amount);
    await pool.deposit(fromSigner, amount, fromSigner);

    await network.provider.request({
      method: "hardhat_stopImpersonatingAccount",
      params: [from],
    });
  }
}
DeployLocalForked.deploy();
