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
    const stETHToken = new ERC20("ILido", (await ethers.getContract('Lido')));
  
    const latestBlock = await ethers.provider.getBlock('latest');
    console.log(`Latest block number: ${latestBlock.number}`);

    // Deploy vault authorizer and vault
    const authorizer = await ContractBase.deployContract("Authorizer", owner.address);
    const vault = await ContractBase.deployContract("Vault", authorizer.address, wEthToken.address, 3 * MONTH, MONTH);

    // Deploy Tempus Controller
    const tempusController: TempusController = await TempusController.deploy();

    // Deploy Tempus pool backed by Aave (aDAI Token)
    const maturityTimeAave = latestBlock.timestamp + DAY * 365;
    const poolNamesAave = generateTempusSharesNames("aDai aave token", "aDai", maturityTimeAave);
    const yieldEstAave = 0.1;
    const tempusPoolAave = await TempusPool.deployAave(aDaiToken, tempusController, maturityTimeAave, yieldEstAave, poolNamesAave);

    // Deploy Tempus pool backed by Lido (stETH Token)
    const maturityTimeLido = latestBlock.timestamp + DAY * 365;
    const yieldEstLido = 0.1;
    const namesLido = generateTempusSharesNames("Lido stETH", "stETH", maturityTimeLido);
    const tempusPoolLido = await TempusPool.deployLido(stETHToken, tempusController, maturityTimeLido, yieldEstLido, namesLido);

    // Deploy TempusAMM for Aave TempusPool - we have one AMM per TempusPool
    let tempusAMMAave = await ContractBase.deployContract(
      "TempusAMM",
      vault.address,
      "Tempus LP token",
      "LP",
      tempusPoolAave.address,
      5,
      toWei(0.002),
      3 * MONTH,
      MONTH,
      owner.address
    );

    // Deploy TempusAMM for Lido TempusPool - we have one AMM per TempusPool
    let tempusAMMLido = await ContractBase.deployContract(
      "TempusAMM",
      vault.address,
      "Tempus LP token",
      "LP",
      tempusPoolLido.address,
      5,
      toWei(0.002),
      3 * MONTH,
      MONTH,
      owner.address
    );

    // Deploy stats contract
    const statistics = await ContractBase.deployContract("Stats");

    // Log required information to console.
    console.log('=========== Aave Tempus Pool Info ===========');
    console.log(`Deployed TempusPool Aave contract at: ${tempusPoolAave.address}`);
    console.log(`TPS Aave deployed at: ${tempusPoolAave.principalShare.address}`)
    console.log(`TYS Aave deployed at: ${tempusPoolAave.yieldShare.address}`);
    console.log(`YBT Aave address: ${tempusPoolAave.yieldBearing.address}`);
    console.log(`Deployed TempusPool Aave AMM at: ${tempusAMMAave.address}`);
    console.log('=========== Lido Tempus Pool Info ===========');
    console.log(`Deployed TempusPool Lido contract at: ${tempusPoolLido.address}`);
    console.log(`TPS Lido deployed at: ${tempusPoolLido.principalShare.address}`)
    console.log(`TYS Lido deployed at: ${tempusPoolLido.yieldShare.address}`);
    console.log(`YBT Lido address: ${tempusPoolLido.yieldBearing.address}`);
    console.log(`Deployed TempusPool Lido AMM at: ${tempusAMMLido.address}`);
    console.log('=========== Singleton Contracts Info ========');
    console.log(`Deployed Stats contract at: ${statistics.address}`);
    console.log(`Deployed TempusController at: ${tempusController.address}`);
    console.log(`Deployed Vault at: ${vault.address}`);
  }
}
DeployLocalForked.deploy();
