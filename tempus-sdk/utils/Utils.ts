import { ethers } from "hardhat";
import { expect } from "chai";
import { Contract } from "ethers";
import { Decimal } from "./Decimal";

/**
 * @returns Latest timestamp of the blockchain
 */
export async function blockTimestamp(): Promise<number> {
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
 * Disables Automine until the block `fn` is finished executing.
 * Then manually processes all pending transactions.
 */
export async function evmMineInSingleBlock(fn: ()=>Promise<void>): Promise<void> {
  await evmSetAutomine(false);
  await fn();
  await evmMine();
  await evmSetAutomine(true);
}

/**
 * Increase current EVM time by seconds
 */
export async function increaseTime(addSeconds: number): Promise<void> {
  await ethers.provider.send("evm_increaseTime", [addSeconds]);
  await evmMine();
}

/**
 * Set current EVM time
 */
export async function setEvmTime(timestamp:number): Promise<void> {
  await setNextBlockTimestamp(timestamp);
  await evmMine();
}

/**
 * Set The timestamp of the next block (without mining it)
 */
export async function setNextBlockTimestamp(timestamp:number): Promise<void> {
  await ethers.provider.send("evm_setNextBlockTimestamp", [timestamp]);
}

/**
 * Overwrites storage at address with a new value
 */
export async function setStorageAtAddr(contract:Contract, addr:string, value:Decimal): Promise<any> {
  const val = value.toHexString();
  return ethers.provider.send('hardhat_setStorageAt', [contract.address, addr, val]);
}

/**
 * Overwrites storage by full field name, eg "lido.Lido.beaconBalance" with a new value
 */
export async function setStorageField(contract:Contract, fieldName:string, value:Decimal): Promise<any> {
  const addr = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(fieldName)).replace("0x0", "0x");
  return setStorageAtAddr(contract, addr, value);
}

function parseRevertMessage(msg:string): string {
  if (msg.indexOf("VM Exception while processing transaction:") !== -1) {
    const error1 = "VM Exception while processing transaction: reverted with reason string '";
    let idx = msg.indexOf(error1);
    if (idx !== -1) {
      // ex: "VM Exception while processing transaction: reverted with reason string 'Receiver cannot be 0.'"
      // returns: "Receiver cannot be 0."
      return msg.slice(idx + error1.length, msg.length-1);
    }
  
    const error2 = "VM Exception while processing transaction: reverted with custom error '";
    idx = msg.indexOf(error2);
    if (idx !== -1) {
      // ex: "VM Exception while processing transaction: reverted with custom error 'OnlyControllerAuthorized("0x81aBfd14a19131A347a557A6c5757e7f71910E73")'"
      // returns: ":SenderIsNotStaker"
      const customError = msg.slice(idx + error2.length, msg.length-1);
      // discard the "(arg0, arg1, ...)" part if it's present
      const parentheses = customError.indexOf('(');
      return ":" + (parentheses !== -1 ? customError.substring(0, parentheses) : customError);
    }
  
    // old style where ": revert " was directly followed by error string
    const error3 = "VM Exception while processing transaction: revert ";
    idx = msg.indexOf(error3);
    if (idx !== -1) {
      return msg.slice(idx + error3.length);
    }

    const error4 = "VM Exception while processing transaction: reverted";
    idx = msg.indexOf(error4);
    if (idx !== -1) {
      return msg.slice(idx + error4.length - 8);
    }

    throw new Error(`Unrecognized VM Exception format: "${msg}"`);
  }

  // most likely a raw error or revert string
  return msg;
}

/**
 * Tries to get the Revert Message from an Error
 */
export function getRevertMessage(e:any): string {
  // always prefer e.reason if it's present, because some 
  if (e.reason) {
    // ex: "VM Exception while processing transaction: reverted with reason string 'reverted'"
    // or: "No vesting data for receiver."
    return parseRevertMessage(<string>e.reason);
  }
  if (e.errorName) {
    // errorName: "InvalidTokenIn"
    return ":" + e.errorName; // for custom errors we use ":" prefix
  }
  // this is usually an Error object with revert message in Error.message property
  return parseRevertMessage((<Error>e).message);
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
