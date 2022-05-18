import { beforeEach } from "mocha";
import { Contract } from "ethers";
import { ContractBase, Signer } from "../utils/ContractBase";
import { ethers } from "hardhat";
import { expect } from "chai";
import { setEvmTime, evmSetAutomine, evmMine, blockTimestamp, expectRevert } from "../utils/Utils";
import { describeNonPool } from "../pool-utils/MultiPoolTestSuite";
import { ERC20 } from "../utils/ERC20";
import { Numberish, toWei } from "../utils/DecimalUtils";


interface StakingMathTestCase {
  totalIncentiveSize: number;
  rewardsDuration: number;
  otherUsersStakedAmountSum: number;
  userStakedAmount: number;
  userStakeStart: number;
  userStakeEnd: number;
  maxWithdrawalFee: number;

  expectedTotalRewards: number;
}

describeNonPool("StakingRewards", async () => {
  let stakingRewards: Contract;
  let rewardsToken: ERC20;
  let owner:Signer, user:Signer, user2:Signer;

  async function initializeStakingRewards(reward: Numberish, expiresIn: number = 24 * 60 * 60): Promise<any> {
    const currentTime = await blockTimestamp();
    await rewardsToken.approve(owner, stakingRewards.address, toWei(reward));
    return stakingRewards.initialize(toWei(reward), currentTime + expiresIn);
}

  beforeEach(async () => {
    [owner, user, user2] = await ethers.getSigners();

    rewardsToken = await ERC20.deploy(
      "ERC20FixedSupply", 18, 18, "Reward Token", "RWRD", toWei("66666666666")
    );

    stakingRewards = await ContractBase.deployContract("StakingRewardsHarness", rewardsToken.address, 0);
  });

  describe("Staking/Unstaking", async () => {
    beforeEach(async () => {
        await rewardsToken.approve(owner, stakingRewards.address, "12345.6789101112");
    });

    it("verifies that unstaking reduces balance to 0", async () => {
        const tokenId = 555;
        const stakeAmount = toWei(1234);
        await initializeStakingRewards("12345.6789101112", (await blockTimestamp()) + 60 * 60 * 24);
        await stakingRewards.stake(stakeAmount, tokenId);

        expect(await stakingRewards.sharesOf(tokenId)).to.be.equal(stakeAmount);
        await stakingRewards.unstakeAndClaimRewardsTo(tokenId, user.address);
        expect(await stakingRewards.sharesOf(tokenId)).to.be.equal(0);
    });

    it("verifies collecting fees with a zero address recipient reverts", async () => {
        (await expectRevert(stakingRewards.collectFees(ethers.constants.AddressZero))).to.equal(":ZeroAddress");
    });
    it("verifies staking with a zero amount reverts", async () => {
        await initializeStakingRewards("12345.6789101112", (await blockTimestamp()) + 60 * 60 * 24);
        (await expectRevert(stakingRewards.stake(0, 1))).to.equal(":ZeroAmount");
    });
    it("verifies staking with a token ID that is already staked reverts", async () => {
        await initializeStakingRewards("12345.6789101112", (await blockTimestamp()) + 60 * 60 * 24);
        await stakingRewards.stake(69420, 69420);
        (await expectRevert(stakingRewards.stake(69420, 69420))).to.equal(":TokenIdAlreadyStaked");
    });
    it("verifies unstaking a tokenId that is not staked reverts", async () => {
        await initializeStakingRewards("12345.6789101112", (await blockTimestamp()) + 60 * 60 * 24);
        (await expectRevert(stakingRewards.unstakeAndClaimRewardsTo(69420, user.address))).to.equal(":TokenIdNotFound");
    });
    it("verifies claiming rewards to a zero address recipient reverts", async () => {
        await initializeStakingRewards("12345.6789101112", (await blockTimestamp()) + 60 * 60 * 24);
        (await expectRevert(stakingRewards.claimRewardsTo(69420, ethers.constants.AddressZero))).to.equal(":ZeroAddress");
    });
    it("verifies initializing rewards with a zero amount reverts", async () => {
        (await expectRevert(initializeStakingRewards(0))).to.equal(":ZeroAmount");
    });
    it("verifies initializing rewards with an expiration in the past reverts", async () => {
        (await expectRevert(initializeStakingRewards(1, -1))).to.equal(":ExpirationTooSmall");
    });
    it("verifies initializing rewards with an expiration in the past reverts", async () => {
        (await expectRevert(initializeStakingRewards(1, -1))).to.equal(":ExpirationTooSmall");
    });
    it("verifies setting a Maximum Early Withdrawal Fee greater than 1e18 reverts", async () => {
        (await expectRevert(stakingRewards.setMaxEarlyWithdrawalFee(toWei(1).add(1)))).to.equal(":MaxEarlyWithdrawalFeeTooBig");
    });
  });

  describe("Rewards Initialization/Termination", async () => {
    it("verifies initialize sets staking variables correctly", async () => {
        const rewards = "12345.6789101112";
        const expiresIn = 60 * 60 * 24;
        const expiration = (await blockTimestamp()) + expiresIn;
        await initializeStakingRewards(rewards, expiresIn);
        
        const startTime = await stakingRewards.startTime();
        const rewardsDuration = await stakingRewards.rewardsDuration();
        const totalIncentiveSize = await stakingRewards.totalIncentiveSize();

        expect(startTime.add(rewardsDuration)).to.equal(expiration);
        expect(totalIncentiveSize).to.equal(toWei(rewards));
    });
    it("verifies initialize cannot be called twice", async () => {
        const rewards = "12345.6789101112";
        await rewardsToken.approve(owner, stakingRewards.address, rewards);
        await initializeStakingRewards(rewards);
        (await expectRevert(initializeStakingRewards(rewards))).to.equal(":RewardsAlreadyInitialized");
    });
    it("verifies rewards can be terminated if no funds are staked", async () => {
        const rewards = "12345.6789101112";
        await rewardsToken.approve(owner, stakingRewards.address, rewards);
        await initializeStakingRewards(rewards);
        
        const balanceBefore = await rewardsToken.balanceOf(owner.address);
        await stakingRewards.terminate();
        const balanceAfter = await rewardsToken.balanceOf(owner.address);

        expect(balanceAfter.equals(balanceBefore.add(toWei(rewards)))).to.be.true;
    });
    it("verifies rewards cannot be terminated if they were already terminated", async () => {
        await initializeStakingRewards("12345.6789101112");
        
        await stakingRewards.terminate();
        (await expectRevert(stakingRewards.terminate())).to.equal(":RewardsAlreadyWithdrawn");
    });
    it("verifies rewards cannot be initialized after rewards termination", async () => {
        await initializeStakingRewards("12345.6789101112");
        
        await stakingRewards.terminate();
        (await expectRevert(initializeStakingRewards("12345.6789101112"))).to.equal(":RewardsAlreadyWithdrawn");
    });
    it("verifies funds cannot be staked after rewards are terminated", async () => {
        await initializeStakingRewards("12345.6789101112");
        
        await stakingRewards.terminate();
        (await expectRevert(stakingRewards.stake(3, 1))).to.equal(":RewardsNotInitialized");
    });
    it("verifies attempting to terminate rewards when some funds are staked reverts", async () => {
        await initializeStakingRewards("12345.6789101112");
        
        await stakingRewards.connect(user2).stake(3, 1);
        
        (await expectRevert(stakingRewards.terminate())).to.equal(":CannotTerminateWhenNotEmpty");
    });
  });

  describe("Fees", async () => {
    it("verifies that the Effective Early Withdrawal Fee is applied to the earned rewards when rewards are claimed", async () => {
        const MAX_ERROR = 0.00001; // 0.001%
        
        const rewards = "12345.6789101112";
        const tokenId = 1;
        await stakingRewards.setMaxEarlyWithdrawalFee(toWei(0.5));
        
        await initializeStakingRewards(rewards, 60 * 60 * 24 * 7);
        
        await stakingRewards.stake(10000, tokenId);
        await setEvmTime((await blockTimestamp()) + 60 * 60 * 24 * 3);
        const rewardsEarnedExcludingFees = await stakingRewards.earned(tokenId);
        
        const rewardTokenBalanceBefore = await rewardsToken.balanceOf(user.address);
        await stakingRewards.claimRewardsTo(tokenId, user.address);
        const rewardsClaimedIncludingFees = (await rewardsToken.balanceOf(user.address)).sub(rewardTokenBalanceBefore);
        const effectiveEarlyWithdrawalFee = await stakingRewards.effectiveEarlyWithdrawalFee();
        
        const expectedRewardsClaimedIncludingFees = rewardsEarnedExcludingFees.sub(rewardsEarnedExcludingFees.mul(effectiveEarlyWithdrawalFee).div(toWei(1)))
        const error = rewardsClaimedIncludingFees.div(expectedRewardsClaimedIncludingFees).sub(1).abs();
        
        expect(error.lte(MAX_ERROR)).is.true;
    });

    it("verifies collecting fees sends the fees recipient the exact amount of fees that were acrrued", async () => {
        const rewards = "12345.6789101112";
        const tokenId = 1;
        await stakingRewards.setMaxEarlyWithdrawalFee(toWei(0.5));
        
        await initializeStakingRewards(rewards, 60 * 60 * 24 * 7);
        await stakingRewards.stake(10000, tokenId);
        
        await setEvmTime((await blockTimestamp()) + 60 * 60 * 24 * 3);
        await stakingRewards.claimRewardsTo(tokenId, user.address);

        const feesAccrued = await stakingRewards.feesAccrued();
        const feeCollectorRewardBalanceBefore = await rewardsToken.balanceOf(owner);
        await stakingRewards.collectFees(owner.address);
        const feesCollected = (await rewardsToken.balanceOf(owner.address)).sub(feeCollectorRewardBalanceBefore);

        expect(feesCollected.equals(feesCollected.toDecimal(feesAccrued)));
    });
  });

  describe("Math", async () => {
    const testCases: StakingMathTestCase[] = [
        { totalIncentiveSize: 100001, rewardsDuration: 7776000, otherUsersStakedAmountSum: 500, userStakedAmount: 2000, userStakeStart: 4558, userStakeEnd: 61000, maxWithdrawalFee: 0, expectedTotalRewards: 1156.49463161651 },
        { totalIncentiveSize: 66666666666, rewardsDuration: 1036800, otherUsersStakedAmountSum: 9000, userStakedAmount: 50, userStakeStart: 1000, userStakeEnd: 61000, maxWithdrawalFee: 0, expectedTotalRewards: 41356209.1882795 },
        { totalIncentiveSize: 66666666666, rewardsDuration: 1036800, otherUsersStakedAmountSum: 9000, userStakedAmount: 50, userStakeStart: 1000, userStakeEnd: 61000, maxWithdrawalFee: 0.151234, expectedTotalRewards: 35469151.4005804 },
        { totalIncentiveSize: 0.1, rewardsDuration: 536800, otherUsersStakedAmountSum: 1000, userStakedAmount: 100000, userStakeStart: 21000, userStakeEnd: 162500, maxWithdrawalFee: 0, expectedTotalRewards: 0.0432765599106137 },
        { totalIncentiveSize: 10000, rewardsDuration: 15552123, otherUsersStakedAmountSum: 1234567, userStakedAmount: 12345, userStakeStart: 30002, userStakeEnd: 123456, maxWithdrawalFee: 0.151234, expectedTotalRewards: 1.006346163067 },
        { totalIncentiveSize: 10000, rewardsDuration: 15552123, otherUsersStakedAmountSum: 0, userStakedAmount: 12345, userStakeStart: 123, userStakeEnd: 123456, maxWithdrawalFee: 0.451234, expectedTotalRewards: 87.257650335091 },
    ];

    for (let i = 0; i < testCases.length; i++) {
        const {
            totalIncentiveSize,
            rewardsDuration,
            otherUsersStakedAmountSum,
            userStakedAmount,
            userStakeStart,
            userStakeEnd,
            expectedTotalRewards,
            maxWithdrawalFee
        } = testCases[i]
        it(`rewards calculation case #${i + 1}`, async () =>
        {
            const MAX_ERROR = 0.0001; // 0.01%
                
            await stakingRewards.setMaxEarlyWithdrawalFee(toWei(maxWithdrawalFee));
            await evmSetAutomine(false);
            await initializeStakingRewards(totalIncentiveSize, rewardsDuration);
            if (otherUsersStakedAmountSum > 0) {
                const otherUsersStakeAmount = toWei(otherUsersStakedAmountSum);
                await stakingRewards.connect(user2).stake(otherUsersStakeAmount, 1);
            }

            await evmMine();
            const startTime = await blockTimestamp();
            
            if (userStakeStart > 0) {
                await setEvmTime(startTime + userStakeStart);
            }

            if (userStakedAmount > 0) {
                const _userStakeAmount = toWei(userStakedAmount);
                await stakingRewards.connect(user).stake(_userStakeAmount, 2);
                await evmMine();
            }

            await setEvmTime(startTime + userStakeEnd);
            const rewardTokenBalanceBefore = await rewardsToken.balanceOf(owner.address);
            await stakingRewards.claimRewardsTo(2, owner.address);
            await evmMine();
            const totalRewards = (await rewardsToken.balanceOf(owner.address)).sub(rewardTokenBalanceBefore);
            
            const error = totalRewards.div(expectedTotalRewards).sub(1).abs();
            expect(error.lte(MAX_ERROR)).to.be.true;
            
            await evmSetAutomine(true);
        });
    }
  });
}); 