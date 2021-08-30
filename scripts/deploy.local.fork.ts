// External libraries
import { ethers, network, getNamedAccounts } from 'hardhat';

// Test Utils
import { ERC20 } from '../test/utils/ERC20';
import { generateTempusSharesNames, TempusPool } from '../test/utils/TempusPool';
import { ContractBase } from '../test/utils/ContractBase';
import { TempusController } from '../test/utils/TempusController';
import { DAY, MONTH } from '../test/utils/TempusAMM';
import { toWei } from '../test/utils/Decimal';

class DeployLocalForked {
  static async deploy() {
    const owner = (await ethers.getSigners())[0];

    const aDaiToken = new ERC20("ERC20", (await ethers.getContract('aToken_Dai')));
    const wEthToken = new ERC20("ERC20", (await ethers.getContract('aToken_Weth')));
  
    const latestBlock = await ethers.provider.getBlock('latest');
    console.log(`Latest block number: ${latestBlock.number}`);

    // Deploy vault authorizer and vault
    const authorizer = await ContractBase.deployContract("Authorizer", owner.address);
    const vault = await ContractBase.deployContract("Vault", authorizer.address, wEthToken.address, 3 * MONTH, MONTH);

    // Deploy Tempus pool backed by Aave (aDAI Token)
    const maturityTime = latestBlock.timestamp + DAY * 365;
    const names = generateTempusSharesNames("aDai aave token", "aDai", maturityTime);
    const yieldEst = 0.1;
    const tempusController: TempusController = await TempusController.deploy();
    const tempusPool = await TempusPool.deployAave(aDaiToken, tempusController, maturityTime, yieldEst, names);

    // Deploy TempusAMM for Aave TempusPool - we have one AMM per TempusPool
    let tempusAMM = await ContractBase.deployContract(
      "TempusAMM",
      vault.address,
      "Tempus LP token",
      "LP",
      tempusPool.address,
      5,
      toWei(0.002),
      3 * MONTH,
      MONTH,
      owner.address
    );

    // Deploy stats contract
    const statistics = await ContractBase.deployContract("Stats");

    // Log required information to console.
    console.log(`Deployed TempusPool contract at: ${tempusPool.address}`);
    console.log(`Deployed TempusPool AMM at: ${tempusAMM.address}`);
    console.log(`TPS deployed at: ${tempusPool.principalShare.address}`)
    console.log(`TYS deployed at: ${tempusPool.yieldShare.address}`);
    console.log(`YBT address: ${tempusPool.yieldBearing.address}`);
    console.log(`Deployed Statistics contract at: ${statistics.address}`);
    console.log(`Deployed TempusController at: ${tempusController.address}`);
    console.log(`Deployed Vault at: ${vault.address}`);
  }

}
DeployLocalForked.deploy();
