import { ethers } from "hardhat";

async function increaseTime(addSeconds: number) : Promise<void> {
    await ethers.provider.send("evm_increaseTime", [addSeconds]);
    await ethers.provider.send("evm_mine", []);
}
increaseTime(60*10);
