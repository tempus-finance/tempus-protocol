import { expect } from "chai";
import { MockContract } from "@ethereum-waffle/mock-contract";
import { ContractBase, Signer } from "@tempus-sdk/utils/ContractBase";
import { blockTimestamp, expectRevert, setEvmTime } from "@tempus-sdk/utils/Utils";
import { Numberish, parseDecimal, toWei } from "@tempus-sdk/utils/DecimalUtils";
import { Contract, BigNumber } from "ethers";
import { ERC20 } from "@tempus-sdk/utils/ERC20";
import { ethers, network, waffle } from "hardhat";
import { describeNonPool } from "../pool-utils/MultiPoolTestSuite";

const { abi: POSITION_MANAGER_ABI } = require("../../artifacts/contracts/IPositionManager.sol/IPositionManager");

const REWARD_TOKEN_DECIMALS = 18;
describeNonPool("LeverageIncentivization", async () =>
{
  const incentivizedTempusAmm = ethers.Wallet.createRandom().address;
  let owner:Signer, user1:Signer, user2:Signer, user3:Signer;
  let rewardToken: ERC20;
  let positionManagerMock: MockContract;
  let positionManagerMockSigner: Signer;
  let leverageIncentivization: Contract;
  let expiration: number;
  let incentiveSize: BigNumber;

  async function onERC721Received(operator:Signer, tokenId:number, mintedShares:Numberish, txInvoker:Signer = positionManagerMockSigner): Promise<any> {
    return leverageIncentivization.connect(txInvoker).onERC721Received(
      operator.address,
      ethers.constants.AddressZero,
      tokenId,
      ethers.utils.defaultAbiCoder.encode(["uint256"], [toWei(mintedShares)])
    );
  }

  async function unstake(tokenId:number, user:Signer, yieldsRate:Numberish, toBackingToken:boolean = false): Promise<any>
    {
      return leverageIncentivization.connect(user).unstake(tokenId, {
        maxLeftoverShares: toWei("0.01"),
        yieldsRate: toWei(yieldsRate),
        maxSlippage: toWei(0.03),
        deadline: 2594275590,
        toBackingToken: toBackingToken,
        recipient: user.address
      });
    }


  beforeEach(async () =>
  {
    incentiveSize = parseDecimal(1000, REWARD_TOKEN_DECIMALS);
    expiration = (await blockTimestamp()) + 60 * 60 * 24 * 30 * 6; // expiration in 6 months
    [owner, user1, user2, user3] = await ethers.getSigners();
    const [sender] = waffle.provider.getWallets();

    positionManagerMock = await waffle.deployMockContract(sender, POSITION_MANAGER_ABI);
    
    await network.provider.send("hardhat_setBalance", [
      positionManagerMock.address,
      toWei(1).toHexString().replace("0x0", "0x")
    ]);
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [positionManagerMock.address],
    });
    positionManagerMockSigner = await ethers.getSigner(positionManagerMock.address);
    
    rewardToken = await ERC20.deploy(
      "ERC20FixedSupply",
      REWARD_TOKEN_DECIMALS,
      REWARD_TOKEN_DECIMALS,
      "Reward Token",
      "RWRD",
      incentiveSize
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
    await leverageIncentivization.initializeRewards(incentiveSize, expiration);
  });

  it("verifies that a single position staked for the entire rewards duration receives the entire incentive size", async () => {
    await positionManagerMock.mock.position.withArgs(1).returns({ capitals: toWei(40), yields: toWei(150), tempusAMM: incentivizedTempusAmm});
    await positionManagerMock.mock.burn.returns(parseDecimal(100, REWARD_TOKEN_DECIMALS));
    
    await onERC721Received(user1, 1, 50);
    await setEvmTime(expiration);
    
    expect(await rewardToken.contract.balanceOf(user1.address)).equals(0);
    await unstake(1, user1, /*yieldsRate*/"0.1");
    expect(await rewardToken.contract.balanceOf(user1.address)).to.be.closeTo(incentiveSize, parseDecimal("0.001", REWARD_TOKEN_DECIMALS).toNumber());
  });

  it("verifies that unstaking a non-owned position reverts", async () => {
    await positionManagerMock.mock.position.withArgs(1).returns({ capitals: toWei(40), yields: toWei(150), tempusAMM: incentivizedTempusAmm});
    await onERC721Received(user2, 1, 50);

    (await expectRevert(unstake(1, user1, /*yieldsRate*/"0.1"))).to.be.equal(":SenderIsNotStaker");
  });

  it("verifies that invoking onERC721Received from a contract different than the configured PositionManager reverts", async () => {
    await positionManagerMock.mock.position.withArgs(1).returns({ capitals: toWei(40), yields: toWei(150), tempusAMM: incentivizedTempusAmm});
    
    (await expectRevert(onERC721Received(user2, 1, 50, user2))).to.be.equal(":UnauthorizedPositionManager");
  });

  it("verifies that staking a position with equal shares (non-leveraged) reverts", async () => {
    await positionManagerMock.mock.position.withArgs(1).returns({ capitals: toWei(150), yields: toWei(150), tempusAMM: incentivizedTempusAmm});
    
    (await expectRevert(onERC721Received(user1, 1, 50))).to.be.equal(":UnsupportedPositionType");
  });

  it("verifies that staking a position with more capitals than yields (non-leveraged) reverts", async () => {
    await positionManagerMock.mock.position.withArgs(1).returns({ capitals: toWei(150), yields: toWei(150), tempusAMM: incentivizedTempusAmm});
    
    (await expectRevert(onERC721Received(user1, 1, 50))).to.be.equal(":UnsupportedPositionType");
  });

  it("verifies that staking a position of a non-incentivized TempusAmm reverts", async () => {
    const nonIncentivizedTempusAmm = ethers.Wallet.createRandom().address;
    await positionManagerMock.mock.position.withArgs(1).returns({ capitals: toWei(150), yields: toWei(150), tempusAMM: nonIncentivizedTempusAmm});
    
    (await expectRevert(onERC721Received(user1, 1, 50))).to.be.equal(":TempusAmmNotIncentivized");
  });
});
