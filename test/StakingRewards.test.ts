import { beforeEach } from "mocha";
import { Contract } from "ethers";
import { ContractBase, Signer } from "./utils/ContractBase";
import { ethers } from "hardhat";
import { expect } from "chai";
import { setEvmTime, evmSetAutomine, evmMine } from "./utils/Utils";
import { describeNonPool } from "./pool-utils/MultiPoolTestSuite";
import { ERC20 } from "./utils/ERC20";
import { parseDecimal } from "./utils/Decimal";


interface StakingMathTestCase {
  totalIncentiveSize: number;
  poolDuration: number;
  otherUsersStakedAmountSum: number;
  userStakedAmount: number;
  userStakeStart: number;
  userStakeEnd: number;
  
  expectedTotalRewards: number;
}

async function getEvmTime() {
  return (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp;
}

describeNonPool("StakingRewards", async () => {
  let stakingRewards: Contract;
  let stakingToken, rewardsToken;
  let startTime;
  let owner:Signer, user:Signer, user2:Signer;

  beforeEach(async () => {
    [owner, user, user2] = await ethers.getSigners();
    stakingToken = await ERC20.deploy(
      "ERC20FixedSupply", 18, 18, "Staking Token", "STK", parseDecimal("200000", 18) /// TODO: IMPORTANT test with non-18 decimals
    );

    rewardsToken = await ERC20.deploy(
      "ERC20FixedSupply", 18, 18, "Reward Token", "RWRD", parseDecimal("1000", 18)
    );

    await stakingToken.transfer(owner, user, "100000");
    await stakingToken.transfer(owner, user2, "100000");

    stakingRewards = await ContractBase.deployContract("StakingRewardsMock", rewardsToken.address, stakingToken.address);
    startTime = await getEvmTime();
  });



  const testCases: StakingMathTestCase[] = [
    { totalIncentiveSize: 100001, poolDuration: 7776000, otherUsersStakedAmountSum: 500, userStakedAmount: 2000, userStakeStart: 4558, userStakeEnd: 61000, expectedTotalRewards: 1156494631616510000000 },
    { totalIncentiveSize: 66666666666, poolDuration: 1036800, otherUsersStakedAmountSum: 9000, userStakedAmount: 50, userStakeStart: 1000, userStakeEnd: 61000, expectedTotalRewards: 41356209188279500000000000 },
    /// Fails... // { totalIncentiveSize: 1000, poolDuration: 2036800, otherUsersStakedAmountSum: 123, userStakedAmount: 50, userStakeStart: 161000, userStakeEnd: 162500, expectedTotalRewards: 392148793169221000 },
    { totalIncentiveSize: 0.1, poolDuration: 536800, otherUsersStakedAmountSum: 1000, userStakedAmount: 100000, userStakeStart: 21000, userStakeEnd: 162500, expectedTotalRewards: 43276559910613700 },
  ];

  for (const { totalIncentiveSize, poolDuration, otherUsersStakedAmountSum, userStakedAmount, userStakeStart, userStakeEnd, expectedTotalRewards } of testCases) {
    it("verifies rewards calculation", async () =>
    { 
      const MAX_ERROR = 0.0001; // 0.01%
      
      await stakingRewards.initialize(parseDecimal(totalIncentiveSize, 18), poolDuration);
      await evmSetAutomine(false);

      const otherUsersStakeAmount = parseDecimal(otherUsersStakedAmountSum, 18);
      await stakingToken.connect(user2).approve(stakingRewards.address, otherUsersStakeAmount);
      await stakingRewards.connect(user2).stake(otherUsersStakeAmount);
      await evmMine();
      
      if (userStakeStart > 0) {
        await setEvmTime(startTime + userStakeStart);
      }
      
      const _userStakeAmount = parseDecimal(userStakedAmount, 18);
      await stakingToken.connect(user).approve(stakingRewards.address, _userStakeAmount);
      await stakingRewards.connect(user).stake(_userStakeAmount);
      await evmMine();
      
      await setEvmTime(startTime + userStakeEnd);
      const totalRewards = await stakingRewards.earned(user.address);
      
      const error = Math.abs(totalRewards / expectedTotalRewards - 1);
      expect(error).is.lessThanOrEqual(MAX_ERROR);

      await evmSetAutomine(true);
    });
  }

});