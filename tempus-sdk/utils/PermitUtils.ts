import { Numberish } from "./DecimalUtils";
import { ERC20 } from "./ERC20";
import { Signer, Addressable, addressOf } from "../utils/ContractBase";
import { splitSignature } from "ethers/lib/utils";

const permitTypes = {
  Permit: [
    {name: "owner", type: "address"},
    {name: "spender", type: "address"},
    {name: "value", type: "uint256"},
    {name: "nonce", type: "uint256"},
    {name: "deadline", type: "uint256"}
  ]
};

async function getPermitStruct(token: ERC20, owner: Addressable, spender: Addressable, value: Numberish, deadline: Numberish) {  
  return {
    owner: addressOf(owner),
    spender: addressOf(spender),
    value: token.toBigNum(value),
    nonce: await token.contract.nonces(addressOf(owner)),
    deadline: deadline
  };
}

async function getDomain(token: ERC20, chainId: number) {
  return {
    name: await token.name(),
    version: '1',
    chainId: chainId,
    verifyingContract: token.address
  };
}

export async function constructPermit(token:ERC20, user:Signer, spender:Addressable, value:Numberish, deadline:Date) {
    const deadlineInt = parseInt((deadline.getTime() / 1000).toFixed(0));
    const permitData = await getPermitStruct(token, user, spender, value, deadlineInt);
    const signature = splitSignature(await user._signTypedData(
      await getDomain(token, await user.getChainId()), 
      permitTypes, 
      permitData
    ));

    return {
      token: token.address,
      value: permitData.value,
      deadline: permitData.deadline,
      v: signature.v,
      r: signature.r,
      s: signature.s
    };
}