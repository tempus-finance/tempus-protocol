import { ethers } from "hardhat";
import { expect } from "chai";

/**
 * @returns Latest timestamp of the blockchain
 */
export async function blockTimestamp() : Promise<number> {
  return (await ethers.provider.getBlock('latest')).timestamp;
}

/**
 * Increase current EVM time by seconds
 */
export async function increaseTime(addSeconds: number) : Promise<void> {
  await ethers.provider.send("evm_increaseTime", [addSeconds]);
  await ethers.provider.send("evm_mine", []);
}

/**
 * Set current EVM time
 */
export async function setEvmTime(timestamp:number) : Promise<void> {
  await ethers.provider.send("evm_setNextBlockTimestamp", [timestamp]);
  await ethers.provider.send("evm_mine", []);
}

/**
 * Tries to get the Revert Message from an Error
 */
export function getRevertMessage(e:Error): string {
  const expectedErrorMsg = "VM Exception while processing transaction: revert ";
  let idx = e.message.indexOf(expectedErrorMsg);
  if (idx !== -1) {
    return e.message.substr(idx + expectedErrorMsg.length);
  }
  let msgStart = e.message.indexOf('\'');
  if (msgStart !== -1) {
    return e.message.substr(msgStart + 1, e.message.length - msgStart - 2);
  }
  return e.message; // something else failed
}

/**
 * Expect called promise to revert with message
 * (await expectRevert(lido.withdraw(..))).to.equal("expected revert msg");
 */
export async function expectRevert(promise: Promise<any>): Promise<Chai.Assertion> {
  try {
    await promise;
    return expect('TX_NOT_REVERTED');
  } catch (e) {
    return expect(getRevertMessage(e));
  }
}
