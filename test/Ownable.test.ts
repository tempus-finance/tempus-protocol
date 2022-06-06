import { Contract } from "ethers";
import { ContractBase, Signer } from "@tempus-sdk/utils/ContractBase";
import { ethers } from "hardhat";
import { expect } from "chai";
import { expectRevert } from "@tempus-sdk/utils/Utils";
import { describeNonPool } from "./pool-utils/MultiPoolTestSuite";

describeNonPool("Ownable", async () => {
  let ownable: Contract;
  let owner:Signer, user:Signer, user2:Signer;

  beforeEach(async () => {
    [owner, user, user2] = await ethers.getSigners();
    ownable = await ContractBase.deployContract("OwnableMock");
  });

  it("Check initial owner on deployment", async () => {
    expect(await ownable.owner()).to.be.equal(owner.address);
  });

  it("transferOwnership invalid inputs", async () => {
    (await expectRevert(ownable.connect(user).transferOwnership(user2.address))).to.equal("Ownable: caller is not the owner");
    (await expectRevert(
      ownable.connect(owner).transferOwnership("0x0000000000000000000000000000000000000000")
    )).to.equal("Ownable: new owner is the zero address");
  });

  it("acceptOwnership invalid inputs", async () => {
    (await expectRevert(ownable.connect(owner).acceptOwnership())).to.equal("Ownable: Only proposed owner can accept ownership");
    (await expectRevert(ownable.connect(user).acceptOwnership())).to.equal("Ownable: Only proposed owner can accept ownership");
    await ownable.connect(owner).transferOwnership(user.address);
    (await expectRevert(ownable.connect(user2).acceptOwnership())).to.equal("Ownable: Only proposed owner can accept ownership");
  });

  it("transferOwnership successful flow", async () => {
    expect(await ownable.connect(owner).transferOwnership(user.address)).to.emit(
      ownable,
      "OwnershipProposed"
    ).withArgs(owner.address, user.address);
    expect(await ownable.owner()).to.equal(owner.address);
    expect(await ownable.connect(user).acceptOwnership()).to.emit(
      ownable, 
      "OwnershipTransferred"
    ).withArgs(owner.address, user.address);
    expect(await ownable.owner()).to.equal(user.address);
  });
});
