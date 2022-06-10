import "@nomiclabs/hardhat-ethers"; // hardhat.ethers
import { ethers } from "hardhat";
import { Contract } from "ethers";
import { DecimalConvertible } from "./DecimalConvertible";
import * as signers from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";

/** Alias for ethers Signer with Address */
export type Signer = signers.SignerWithAddress;

/** Alias for all types that can provide an address to the contracts. @see addressOf(addressable) */
export type Addressable = Signer|string|ContractBase|Contract;

/** @return Address field from signer or address string */
export function addressOf(addressable: Addressable): string {
  if (typeof(addressable) === "string")
    return addressable;
  if (addressable instanceof ContractBase || addressable instanceof Contract ||
      addressable instanceof signers.SignerWithAddress)
    return addressable.address;
  throw new Error("Invalid addressable (no address): " + addressable);
}

/**
 * Base class for Any contract
 * Contains several utilities for deploying, attaching and type conversions
 */
export abstract class ContractBase extends DecimalConvertible
{
  contractName:string;
  contract:Contract;
  address:string; // address of the contract, `this.contract.address`

  constructor(contractName:string, decimals:number, contract?:Contract) {
    super(decimals);
    if (!contractName)
      throw new Error("`contractName` cannot be empty or null");
    this.contractName = contractName;
    this.contract = contract!;
    this.address = contract ? contract.address : '0x0';
  }

  protected initialize(contract:Contract) {
    if (!contract)
      throw new Error("`contract` cannot be null");
    this.contract = contract;
    this.address = contract.address;
  }
  
  /** Connects a user to the contract, so that transactions can be sent by the user */
  connect(user:Signer): Contract {
    return this.contract.connect(user);
  }

  /**
   * Deploy a contract of any type
   * @param contractName Name of the solidity contract
   * @param args... Optional arguments for the deployed contract
   */
  static async deployContract(contractName:string, ...args: any[]): Promise<Contract> {
    const factory = await ethers.getContractFactory(contractName);
    return factory.deploy(...args);
  }

  /**
   * Deploy a contract of any type by Deployer user
   * @param contractName Name of the solidity contract
   * @param deployer User who deploys this contract and is marked as `msg.sender` in contract constructor
   * @param args... Optional arguments for the deployed contract
   */
  static async deployContractBy(contractName:string, deployer?:Signer, ...args: any[]): Promise<Contract> {
    const factory = await ethers.getContractFactory(contractName, deployer);
    return factory.deploy(...args);
  }

  /**
   * Attaches to any contract address
   * @param contractName Name of the solidity contract
   * @param contractAddress Address of the contract
   */
  static async attachContract(contractName:string, contractAddress:string): Promise<Contract> {
    const factory = await ethers.getContractFactory(contractName);
    return factory.attach(contractAddress);
  }

  /**
   * Attaches to any contract address with a Signer
   * @param contractName Name of the solidity contract
   * @param contractAddress Address of the contract
   * @param signer Signer to attach with, can be ethers.VoidSigner or SignerWithAddress
   */
  static async attachContractWithSigner(contractName:string, contractAddress:string, signer:Signer): Promise<Contract> {
    const factory = await ethers.getContractFactory(contractName, signer);
    return factory.attach(contractAddress);
  }
}
