import { ethers } from 'hardhat';
import { TempusController } from "../test/utils/TempusController";

async function deployController() {
    const owner = (await ethers.getSigners())[0];

    const controller = await TempusController.deploy(owner);

    console.log(`TempusController deployed at: ${controller.address}`);
}
deployController();
