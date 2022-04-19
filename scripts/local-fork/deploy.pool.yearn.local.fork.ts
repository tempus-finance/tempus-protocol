import { ethers } from 'hardhat';
import { TempusController } from '../../test/utils/TempusController';
import { ERC20 } from '../../test/utils/ERC20';
import { generateTempusSharesNames, TempusPool } from '../../test/utils/TempusPool';
import { HOUR } from '../../test/utils/TempusAMM';
import { ContractBase } from '../../test/utils/ContractBase';
import { toWei } from '../../test/utils/Decimal';
import { promptAddress, promptNumber } from '../utils';

async function deployPool() {
    const owner = (await ethers.getSigners())[0];

    const bt = new ERC20("ERC20FixedSupply", 18, (await ethers.getContract('Dai')));
    const ybt = new ERC20("ERC20FixedSupply", 18, (await ethers.getContract('yvDAI')));

    const vaultAddress = await promptAddress('Enter Vault address:');

    const tempusControllerAddress = await promptAddress('Enter TempusController address:');
    const tempusControllerContract = await ethers.getContractAt('TempusController', tempusControllerAddress);
    const tempusController = new TempusController('TempusController', tempusControllerContract);

    const maturityInHours = await promptNumber('Enter pool duration in hours:');

    const maturityDate = Math.floor(Date.now() / 1000) + Math.floor(HOUR * maturityInHours);

    const pool = await TempusPool.deployYearn(
        owner,
        bt,
        ybt,
        tempusController,
        maturityDate,
        0.0003,
        generateTempusSharesNames('Yearn yvDAI', 'yvDAI', maturityDate)
      );

    let tempusAMM = await ContractBase.deployContract(
      "TempusAMM",
      vaultAddress,
      'Tempus Yearn LP Token',
      'LP-yvDAI',
      pool.address,
      /*amplifyStart*/50,
      /*amplifyEnd*/50,
      toWei(0.002),
      Math.floor(HOUR * maturityInHours),
      Math.floor(HOUR * maturityInHours),
      owner.address
    );

    await tempusController.register(owner, tempusAMM.address);

    console.log(`TempusPool: ${pool.address}`);
    console.log(`Principals: ${pool.principalShare.address}`);
    console.log(`Yields: ${pool.yieldShare.address}`);
    console.log(`PoolID: ${await tempusAMM.getPoolId()}`);
    console.log(`TempusAMM: ${tempusAMM.address}`);
    console.log(`StartDate: ${Number(await pool.startTime()) * 1000}`);
    console.log(`MaturityDate: ${Number(await pool.maturityTime()) * 1000}`)
}
deployPool();
