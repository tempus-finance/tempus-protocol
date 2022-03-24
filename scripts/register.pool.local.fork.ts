import { ethers } from 'hardhat';
import { TempusController } from '../test/utils/TempusController';
import { promptAddress } from './utils';

async function registerPool() {
    const owner = (await ethers.getSigners())[0];

    const tempusControllerAddress = await promptAddress('Enter TempusController address:');

    const tempusControllerContract = await ethers.getContractAt('TempusController', tempusControllerAddress);
    const tempusController = new TempusController('TempusController', tempusControllerContract);

    const tempusAMMToRegisterAddress = await promptAddress('Enter TempusAMM address to register:');
    await tempusController.register(owner, tempusAMMToRegisterAddress);

    const tempusPoolToRegisterAddress = await promptAddress('Enter TempusPool address to register:');
    await tempusController.register(owner, tempusPoolToRegisterAddress);
}
registerPool();
