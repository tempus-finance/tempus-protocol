import { expect } from "chai";
import { Contract } from "ethers";
import { ethers, waffle } from "hardhat";
import { MockContract } from "@ethereum-waffle/mock-contract";
import { ContractBase, Signer } from "@tempus-labs/utils/ts/utils/ContractBase";
import { blockTimestamp, expectRevert, impersonateAccount, setBalanceOf, setEvmTime } from "@tempus-labs/utils/ts/utils/Utils";
import { decimal } from "@tempus-labs/utils/ts/utils/Decimal";
import { Numberish, parseDecimal } from "@tempus-labs/utils/ts/utils/DecimalUtils";
import { ERC20 } from "@tempus-labs/utils/ts/token/ERC20";
import { describeNonPool } from "../pool-utils/MultiPoolTestSuite";

const { abi: POSITION_MANAGER_ABI } = require("../../artifacts/contracts/IPositionManager.sol/IPositionManager");

const REWARD_DECIMALS = 18;

describeNonPool("LeverageIncentivization", async () =>
{
  const incentivizedTempusAmm = ethers.Wallet.createRandom().address;
  let owner:Signer, user1:Signer, user2:Signer, user3:Signer;
  let rewardToken: ERC20;
  let positionManagerMock: MockContract;
  let positionManagerMockSigner: Signer;
  let leverageIncentivization: Contract;
  let expiration: number;
  let incentiveSize: number;

  // fixed-point scaled int for Incentivization contracts
  const fp = (number:Numberish) => parseDecimal(number, REWARD_DECIMALS);

  async function onERC721Received(operator:Signer, tokenId:number, mintedShares:Numberish, txInvoker:Signer = positionManagerMockSigner): Promise<any> {
    return leverageIncentivization.connect(txInvoker).onERC721Received(
      operator.address,
      ethers.constants.AddressZero,
      tokenId,
      ethers.utils.defaultAbiCoder.encode(["uint256"], [fp(mintedShares)])
    );
  }

  async function unstake(tokenId:number, user:Signer, yieldsRate:Numberish, toBackingToken:boolean = false): Promise<any>
  {
    return leverageIncentivization.connect(user).unstake(tokenId, {
      maxLeftoverShares: fp("0.01"),
      yieldsRate: fp(yieldsRate),
      maxSlippage: fp(0.03),
      deadline: 2594275590,
      toBackingToken: toBackingToken,
      recipient: user.address
    });
  }

  async function setMockPosition(tokenId:number, capitals:Numberish, yields:Numberish, amm = incentivizedTempusAmm): Promise<void> {
    await positionManagerMock.mock.position.withArgs(tokenId).returns(
      { capitals: fp(capitals), yields: fp(yields), tempusAMM: amm}
    );
  }

  beforeEach(async () =>
  {
    incentiveSize = 1000.0;
    expiration = (await blockTimestamp()) + 60 * 60 * 24 * 30 * 6; // expiration in 6 months
    [owner, user1, user2, user3] = await ethers.getSigners();
    const [sender] = waffle.provider.getWallets();

    positionManagerMock = await waffle.deployMockContract(sender, POSITION_MANAGER_ABI);
    await setBalanceOf(positionManagerMock.address, decimal(1.0));
    positionManagerMockSigner = await impersonateAccount(positionManagerMock.address);

    rewardToken = await ERC20.deploy(
      "ERC20FixedSupply", REWARD_DECIMALS, REWARD_DECIMALS, "Reward Token", "RWRD", fp(incentiveSize)
    );
    leverageIncentivization = await ContractBase.deployContract(
      "LeverageIncentivization",
      positionManagerMock.address,
      rewardToken.address,
      incentivizedTempusAmm,
      0,
      "Staked Tempus Positions",
      "stPOSITION"
    );
    
    await rewardToken.approve(owner, leverageIncentivization.address, incentiveSize);
    await leverageIncentivization.initializeRewards(fp(incentiveSize), expiration);
  });

  it("verifies that a single position staked for the entire rewards duration receives the entire incentive size", async () => {
    await setMockPosition(/*tokenId*/1, /*capitals*/40, /*yields*/150);
    await positionManagerMock.mock.burn.returns(fp(100));
    
    await onERC721Received(user1, 1, 50);
    await setEvmTime(expiration);

    expect(+await rewardToken.balanceOf(user1)).to.equal(0);
    await unstake(1, user1, /*yieldsRate*/"0.1");
    expect(+await rewardToken.balanceOf(user1)).to.be.closeTo(incentiveSize, 0.001);
  });

  it("verifies that unstaking a non-owned position reverts", async () => {
    await setMockPosition(/*tokenId*/1, /*capitals*/40, /*yields*/150);
    await onERC721Received(user2, 1, 50);
    (await expectRevert(unstake(1, user1, /*yieldsRate*/"0.1"))).to.be.equal(":SenderIsNotStaker");
  });

  it("verifies that invoking onERC721Received from a contract different than the configured PositionManager reverts", async () => {
    await setMockPosition(/*tokenId*/1, /*capitals*/40, /*yields*/150);
    (await expectRevert(onERC721Received(user2, 1, 50, user2))).to.be.equal(":UnauthorizedPositionManager");
  });

  it("verifies that staking a position with equal shares (non-leveraged) reverts", async () => {
    await setMockPosition(/*tokenId*/1, /*capitals*/150, /*yields*/150);
    (await expectRevert(onERC721Received(user1, 1, 50))).to.be.equal(":UnsupportedPositionType");
  });

  it("verifies that staking a position with more capitals than yields (non-leveraged) reverts", async () => {
    await setMockPosition(/*tokenId*/1, /*capitals*/150, /*yields*/150);
    (await expectRevert(onERC721Received(user1, 1, 50))).to.be.equal(":UnsupportedPositionType");
  });

  it("verifies that staking a position of a non-incentivized TempusAmm reverts", async () => {
    const nonIncentivizedTempusAmm = ethers.Wallet.createRandom().address;
    await setMockPosition(/*tokenId*/1, /*capitals*/150, /*yields*/150, /*amm*/nonIncentivizedTempusAmm);
    (await expectRevert(onERC721Received(user1, 1, 50))).to.be.equal(":TempusAmmNotIncentivized");
  });
});
