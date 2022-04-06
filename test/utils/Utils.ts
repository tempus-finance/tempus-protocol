import { ethers } from "hardhat";
import { expect } from "chai";
import { BigNumber, Contract } from "ethers";

/**
 * @returns Latest timestamp of the blockchain
 */
export async function blockTimestamp() : Promise<number> {
  return (await ethers.provider.getBlock('latest')).timestamp;
}

/**
 * Mines a block
 */
 export async function evmMine(): Promise<void> {
  await ethers.provider.send("evm_mine", []);
}

/**
 * sets the current EVM automining behavior.
 * if true - a block is mined for every sent transaction (default is true)
 */
 export async function evmSetAutomine(automine: boolean): Promise<void> {
  await ethers.provider.send("evm_setAutomine", [automine]);
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
  await setNextBlockTimestamp(timestamp);
  await evmMine();
}

/**
 * Set The timestamp of the next block (without mining it)
 */
export async function setNextBlockTimestamp(timestamp:number) : Promise<void> {
  await ethers.provider.send("evm_setNextBlockTimestamp", [timestamp]);
}

/**
 * Overwrites storage at address with a new value
 */
export async function setStorageAtAddr(contract:Contract, addr:string, value:string|BigNumber): Promise<any> {
  let val:string;
  if (typeof(value) === "string") {
    val = value;
  } else {
    val = ethers.utils.hexZeroPad(value.toHexString(), 32);
  }
  return ethers.provider.send('hardhat_setStorageAt', [contract.address, addr, val]);
}

/**
 * Overwrites storage by full field name, eg "lido.Lido.beaconBalance" with a new value
 */
 export async function setStorageField(contract:Contract, fieldName:string, value:string|BigNumber): Promise<any> {
  const addr = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(fieldName)).replace("0x0", "0x");
  return setStorageAtAddr(contract, addr, value);
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
    let braceIdx = e.message.indexOf("(");

    if (braceIdx !== -1) {
      return ":" + e.message.substring(msgStart + 1, braceIdx);
    }
    return e.message.substr(msgStart + 1, e.message.length - msgStart - 2);
  }
  return e.message; // something else failed
}

/**
 * Expect called promise to revert with message
 * (await expectRevert(lido.withdraw(..))).to.equal("expected revert msg");
 *
 * We use this helper instead of `.to.be.revertedWith`, because that doesn't allow showing a stack trace,
 * and this one does.
 */
export async function expectRevert(promise: Promise<any>): Promise<Chai.Assertion> {
  try {
    await promise;
    return expect('success');
  } catch (e) {
    return expect(getRevertMessage(e));
  }
}
