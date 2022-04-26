// SPDX-License-Identifier: GPL-3.0-or-later
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

pragma solidity 0.8.10;

import "@openzeppelin/contracts/token/ERC20/extensions/draft-ERC20Permit.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

import "./ITempusAMM.sol";
import "./../token/IPoolShare.sol";

import "./math/StableMath.sol";
import "../utils/Ownable.sol";
import "../math/Fixed256x18.sol";
import "../math/Fixed256xVar.sol";

contract TempusAMM is ITempusAMM, ERC20Permit, Pausable, Ownable {
    using Fixed256x18 for uint256;
    using Fixed256xVar for uint256;

    // This contract uses timestamps to slowly update its Amplification parameter over time. These changes must occur
    // over a minimum time period much larger than the blocktime, making timestamp manipulation a non-issue.
    // solhint-disable not-rely-on-time

    // Amplification factor changes must happen over a minimum period of one day, and can at most divide or multiple the
    // current value by 2 every day.
    // WARNING: this only limits *a single* amplification change to have a maximum rate of change of twice the original
    // value daily. It is possible to perform multiple amplification changes in sequence to increase this value more
    // rapidly: for example, by doubling the value every day it can increase by a factor of 8 over three days (2^3).
    uint256 private constant MIN_UPDATE_TIME = 1 days;
    uint256 private constant MAX_AMP_UPDATE_DAILY_RATE = 2;
    uint256 private constant MIN_AMPLIFICATION = 1 * 1000; // StableMath._MIN_AMP * StableMath._AMP_PRECISION;
    uint256 private constant MAX_AMPLIFICATION = 5000 * 1000; // StableMath._MAX_AMP * StableMath._AMP_PRECISION;

    // Maximum swap fee is set to 5%
    uint256 private constant MAX_SWAP_FEE_PERCENTAGE = 0.05e18;

    // fixed point precision of TempusShare tokens
    uint256 private immutable TEMPUS_SHARE_PRECISION;

    struct AmplificationData {
        uint64 startValue;
        uint64 endValue;
        uint64 startTime;
        uint64 endTime;
    }

    AmplificationData private amplificationData;

    IPoolShare public immutable token0;
    IPoolShare public immutable token1;

    // All token balances are normalized to behave as if the token had 18 decimals. We assume a token's decimals will
    // not change throughout its lifetime, and store the corresponding scaling factor for each at construction time.
    // These factors are always greater than or equal to one: tokens with more than 18 decimals are not supported.
    uint256 private immutable scalingFactor;

    uint256 public swapFeePercentage;

    error SwapAmountNoConvergence();

    constructor(
        string memory name,
        string memory symbol,
        IPoolShare t0,
        IPoolShare t1,
        uint256 amplificationStartValue,
        uint256 amplificationEndValue,
        uint256 amplificationEndTime,
        uint256 swapFeePerc
    ) ERC20(name, symbol) ERC20Permit(name) {
        if (swapFeePerc > MAX_SWAP_FEE_PERCENTAGE) {
            revert SwapFeeTooBig(swapFeePerc, MAX_SWAP_FEE_PERCENTAGE);
        }
        swapFeePercentage = swapFeePerc;

        (token0, token1) = (t0, t1);

        if (t0.decimals() != t1.decimals()) {
            revert TokenDecimalsMismatch(t0, t1);
        }
        TEMPUS_SHARE_PRECISION = 10**t0.decimals();

        scalingFactor = Fixed256x18.ONE * 10**(18 - t0.decimals());

        setInitialAmplification(amplificationStartValue);
        if (amplificationStartValue != amplificationEndValue) {
            if (amplificationStartValue >= amplificationEndValue) {
                revert StartingAmplificationValueBiggerThanEndingAmplificationValue(
                    amplificationStartValue,
                    amplificationEndValue
                );
            }
            startAmplificationParameterUpdate(amplificationEndValue, amplificationEndTime);
        }
    }

    // Adding liquidity

    function join(
        uint256 amountToken0,
        uint256 amountToken1,
        uint256 minLpTokensOut,
        address recipient
    ) external override whenNotPaused {
        (uint256 amountIn0, uint256 amountIn1) = getRateAdjustedAmounts(
            amountToken0,
            amountToken1,
            token0.getPricePerFullShare(),
            token1.getPricePerFullShareStored()
        );

        uint256 lpTokensOut;
        if (totalSupply() == 0) {
            if (amountToken0 == 0 || amountToken1 == 0) {
                revert ZeroTokenAmount();
            }
            lpTokensOut = StableMath.invariant(_getAmplificationValue(), amountIn0, amountIn1, true);
        } else {
            if (amountToken0 == 0 && amountToken1 == 0) {
                revert ZeroTokenAmount();
            }
            (uint256 balance0, uint256 balance1) = getRateAdjustedBalances();

            lpTokensOut = StableMath.lpOutGivenTokensIn(
                _getAmplificationValue(),
                balance0,
                balance1,
                amountIn0,
                amountIn1,
                totalSupply(),
                swapFeePercentage
            );
        }

        if (lpTokensOut < minLpTokensOut) {
            revert AddingLiquidityLPTokensSlippage(lpTokensOut, minLpTokensOut);
        }

        token0.transferFrom(msg.sender, address(this), amountToken0);
        token1.transferFrom(msg.sender, address(this), amountToken1);
        _mint(recipient, lpTokensOut);

        emit Join(amountToken0, amountToken1, lpTokensOut);
    }

    // Removing liquidity

    function exitGivenLpIn(
        uint256 lpTokensIn,
        uint256 minAmountOut0,
        uint256 minAmountOut1,
        address recipient
    ) external override {
        // This exit function is the only one that is not disabled if the contract is paused: it remains unrestricted
        // in an attempt to provide users with a mechanism to retrieve their tokens in case of an emergency.
        // This particular exit function is the only one that remains available because it is the simplest one, and
        // therefore the one with the lowest likelihood of errors.

        (uint256 amountOut0, uint256 amountOut1) = getTokensOutGivenLPIn(lpTokensIn);

        if (amountOut0 < minAmountOut0) {
            revert RemovingLiquidityPoolTokensSlippage(amountOut0, minAmountOut0);
        }
        if (amountOut1 < minAmountOut1) {
            revert RemovingLiquidityPoolTokensSlippage(amountOut1, minAmountOut1);
        }

        _burn(msg.sender, lpTokensIn);
        token0.transfer(recipient, amountOut0);
        token1.transfer(recipient, amountOut1);

        emit Exit(lpTokensIn, amountOut0, amountOut1);
    }

    function exitGivenTokensOut(
        uint256 token0AmountOut,
        uint256 token1AmountOut,
        uint256 maxLpTokensIn,
        address recipient
    ) external override whenNotPaused {
        (uint256 balance0, uint256 balance1) = getRateAdjustedBalances();

        (uint256 amountOut0, uint256 amountOut1) = getRateAdjustedAmounts(
            token0AmountOut,
            token1AmountOut,
            token0.getPricePerFullShare(),
            token1.getPricePerFullShareStored()
        );

        uint256 lpTokensIn = StableMath.lpInGivenTokensOut(
            _getAmplificationValue(),
            balance0,
            balance1,
            amountOut0,
            amountOut1,
            totalSupply(),
            swapFeePercentage
        );
        if (lpTokensIn > maxLpTokensIn) {
            revert RemovingLiquidityLpTokensSlippage(lpTokensIn, maxLpTokensIn);
        }

        _burn(msg.sender, lpTokensIn);
        token0.transfer(recipient, token0AmountOut);
        token1.transfer(recipient, token1AmountOut);

        emit Exit(lpTokensIn, token0AmountOut, token1AmountOut);
    }

    // Swaps

    function swap(
        IPoolShare tokenIn,
        uint256 amount,
        uint256 slippageParam,
        SwapType swapType,
        uint256 deadline
    ) external override whenNotPaused {
        if (deadline < block.timestamp) {
            revert SwapDeadlinePassed(deadline, block.timestamp);
        }
        if (tokenIn != token0 && tokenIn != token1) {
            revert InvalidTokenIn(tokenIn);
        }
        if (amount == 0) {
            revert ZeroTokenAmount();
        }
        (IPoolShare tokenOut, bool firstIn) = (tokenIn == token0) ? (token1, true) : (token0, false);

        (uint256 balance0, uint256 balance1) = getRateAdjustedBalances();

        (uint256 amountIn, uint256 amountOut) = (swapType == SwapType.GIVEN_IN)
            ? (amount, uint256(0))
            : (uint256(0), amount);

        if (swapType == SwapType.GIVEN_IN) {
            uint256 rateAdjustedAmount = subtractSwapFeeAmount(amountIn).mulDown(scalingFactor).mulfV(
                tokenIn.getPricePerFullShare(),
                TEMPUS_SHARE_PRECISION
            );

            uint256 scaledAmountOut = StableMath.outGivenIn(
                _getAmplificationValue(),
                balance0,
                balance1,
                firstIn,
                rateAdjustedAmount
            );

            amountOut = scaledAmountOut.divfV(tokenOut.getPricePerFullShareStored(), TEMPUS_SHARE_PRECISION).divDown(
                scalingFactor
            );

            if (amountOut < slippageParam) {
                revert SwapGivenTokensInSlippage(amountOut, slippageParam);
            }
        } else {
            assert(swapType == SwapType.GIVEN_OUT);

            uint256 rateAdjustedAmount = amountOut.mulDown(scalingFactor).mulfV(
                tokenOut.getPricePerFullShare(),
                TEMPUS_SHARE_PRECISION
            );

            uint256 scaledAmountIn = StableMath.inGivenOut(
                _getAmplificationValue(),
                balance0,
                balance1,
                !firstIn,
                rateAdjustedAmount
            );

            scaledAmountIn = scaledAmountIn.divfV(tokenIn.getPricePerFullShareStored(), TEMPUS_SHARE_PRECISION);
            amountIn = addSwapFeeAmount(scaledAmountIn.divUp(scalingFactor));

            if (amountIn > slippageParam) {
                revert SwapGivenTokensOutSlippage(amountIn, slippageParam);
            }
        }

        tokenIn.transferFrom(msg.sender, address(this), amountIn);
        tokenOut.transfer(msg.sender, amountOut);

        emit Swap(tokenIn, amountIn, amountOut);
    }

    // Query functions

    function compositionBalanceOf(address account)
        external
        view
        override
        returns (uint256 token0Balance, uint256 token1Balance)
    {
        uint256 supply = totalSupply();
        uint256 accountBalance = balanceOf(account);
        token0Balance = (accountBalance * selfBalance0()) / supply;
        token1Balance = (accountBalance * selfBalance1()) / supply;
    }

    function getExpectedReturnGivenIn(uint256 amount, IPoolShare tokenIn) public view override returns (uint256) {
        if (tokenIn != token0 && tokenIn != token1) {
            revert InvalidTokenIn(tokenIn);
        }

        (uint256 balance0, uint256 balance1) = getRateAdjustedBalancesStored();
        (IPoolShare tokenOut, bool firstIn) = (tokenIn == token0) ? (token1, true) : (token0, false);

        uint256 scaledAmount = subtractSwapFeeAmount(amount).mulDown(scalingFactor).mulfV(
            tokenIn.getPricePerFullShareStored(),
            TEMPUS_SHARE_PRECISION
        );

        return
            StableMath
                .outGivenIn(_getAmplificationValue(), balance0, balance1, firstIn, scaledAmount)
                .divfV(tokenOut.getPricePerFullShareStored(), TEMPUS_SHARE_PRECISION)
                .divDown(scalingFactor);
    }

    function getExpectedInGivenOut(uint256 amountOut, IPoolShare tokenIn) external view override returns (uint256) {
        if (tokenIn != token0 && tokenIn != token1) {
            revert InvalidTokenIn(tokenIn);
        }
        (uint256 balance0, uint256 balance1) = getRateAdjustedBalancesStored();
        IPoolShare tokenOut = (tokenIn == token0) ? token1 : token0;

        uint256 rateAdjustedAmountOut = amountOut.mulfV(tokenOut.getPricePerFullShareStored(), TEMPUS_SHARE_PRECISION);

        uint256 amountIn = StableMath.inGivenOut(
            _getAmplificationValue(),
            balance0,
            balance1,
            tokenOut == token0,
            rateAdjustedAmountOut
        );
        amountIn = amountIn.divfV(tokenIn.getPricePerFullShareStored(), TEMPUS_SHARE_PRECISION);
        return addSwapFeeAmount(amountIn);
    }

    function getSwapAmountToEndWithEqualShares(
        uint256 token0Amount,
        uint256 token1Amount,
        uint256 threshold
    ) external view override returns (uint256 amountIn, IPoolShare tokenIn) {
        uint256 difference;
        (difference, tokenIn) = (token0Amount > token1Amount)
            ? (token0Amount - token1Amount, token0)
            : (token1Amount - token0Amount, token1);

        if (difference > threshold) {
            uint256 token0AmountRate = token0.getPricePerFullShareStored();
            uint256 token1AmountRate = token1.getPricePerFullShareStored();

            uint256 rate = (tokenIn == token1)
                ? (token0AmountRate * TEMPUS_SHARE_PRECISION) / token1AmountRate
                : (token1AmountRate * TEMPUS_SHARE_PRECISION) / token0AmountRate;
            for (uint256 i = 0; i < 32; i++) {
                // if we have accurate rate this should hold
                amountIn = (difference * TEMPUS_SHARE_PRECISION) / (rate + TEMPUS_SHARE_PRECISION);
                uint256 amountOut = getExpectedReturnGivenIn(amountIn, tokenIn);
                uint256 newToken0Amount = (tokenIn == token1) ? (token0Amount + amountOut) : (token0Amount - amountIn);
                uint256 newToken1Amount = (tokenIn == token1) ? (token1Amount - amountIn) : (token1Amount + amountOut);
                uint256 newDifference = (newToken0Amount > newToken1Amount)
                    ? (newToken0Amount - newToken1Amount)
                    : (newToken1Amount - newToken0Amount);
                if (newDifference < threshold) {
                    return (amountIn, tokenIn);
                } else {
                    rate = (amountOut * TEMPUS_SHARE_PRECISION) / amountIn;
                }
            }
            revert SwapAmountNoConvergence();
        }
    }

    // NOTE: Return value in AMM decimals precision (1e18)
    function getLPTokensInGivenTokensOut(uint256 token0Out, uint256 token1Out)
        external
        view
        override
        returns (uint256 lpTokens)
    {
        (uint256 balance0, uint256 balance1) = getRateAdjustedBalancesStored();

        (token0Out, token1Out) = getRateAdjustedAmounts(
            token0Out,
            token1Out,
            token0.getPricePerFullShareStored(),
            token1.getPricePerFullShareStored()
        );

        lpTokens = StableMath.lpInGivenTokensOut(
            _getAmplificationValue(),
            balance0,
            balance1,
            token0Out,
            token1Out,
            totalSupply(),
            swapFeePercentage
        );
    }

    function getTokensOutGivenLPIn(uint256 lpTokensIn)
        public
        view
        override
        returns (uint256 token0Out, uint256 token1Out)
    {
        // We don't need to scale balances down here
        // as calculation for amounts out is based on btpAmountIn / totalSupply() ratio
        // Adjusting balances with rate, and then undoing it would just cause additional calculations

        (token0Out, token1Out) = StableMath.tokensOutFromLPIn(
            selfBalance0(),
            selfBalance1(),
            lpTokensIn,
            totalSupply()
        );
    }

    function getLPTokensOutForTokensIn(uint256 token0AmountIn, uint256 token1AmountIn)
        external
        view
        override
        returns (uint256)
    {
        (uint256 balance0, uint256 balance1) = getRateAdjustedBalancesStored();

        (token0AmountIn, token1AmountIn) = getRateAdjustedAmounts(
            token0AmountIn,
            token1AmountIn,
            token0.getPricePerFullShareStored(),
            token1.getPricePerFullShareStored()
        );

        return
            (balance0 == 0)
                ? StableMath.invariant(_getAmplificationValue(), token0AmountIn, token1AmountIn, true)
                : StableMath.lpOutGivenTokensIn(
                    _getAmplificationValue(),
                    balance0,
                    balance1,
                    token0AmountIn,
                    token1AmountIn,
                    totalSupply(),
                    swapFeePercentage
                );
    }

    function getTokensInGivenMaximum(uint256 maxAmount)
        external
        view
        override
        returns (uint256 token0Amount, uint256 token1Amount)
    {
        if (totalSupply() == 0) {
            revert NotInitialisedYet();
        }
        uint256 token0Balance = selfBalance0();
        uint256 token1Balance = selfBalance1();

        (uint256 token0Scale, uint256 token1Scale) = (token0Balance > token1Balance)
            ? (Fixed256x18.ONE, token1Balance.divDown(token0Balance))
            : (token0Balance.divDown(token1Balance), Fixed256x18.ONE);

        token0Amount = maxAmount.mulDown(token0Scale);
        token1Amount = maxAmount.mulDown(token1Scale);
    }

    // Amplification

    // NOTE: this function MUST be called in the constructor
    function setInitialAmplification(uint256 startValue) private {
        if (startValue < MIN_AMPLIFICATION) {
            revert AmplificationValueTooSmall(startValue, MIN_AMPLIFICATION);
        }
        if (startValue > MAX_AMPLIFICATION) {
            revert AmplificationValueTooBig(startValue, MAX_AMPLIFICATION);
        }

        _setAmplificationData(startValue, startValue, block.timestamp, block.timestamp);
        emit AmpUpdateStarted(startValue, startValue, block.timestamp, block.timestamp);
        emit AmpUpdateStopped(startValue);
    }

    function startAmplificationParameterUpdate(uint256 endValue, uint256 endTime) public onlyOwner {
        if (endValue < MIN_AMPLIFICATION) {
            revert AmplificationValueTooSmall(endValue, MIN_AMPLIFICATION);
        }
        if (endValue > MAX_AMPLIFICATION) {
            revert AmplificationValueTooBig(endValue, MAX_AMPLIFICATION);
        }

        uint256 duration = endTime - block.timestamp;
        if (duration < MIN_UPDATE_TIME) {
            revert AmplificationValueUpdateEndTimeTooClose(duration, MIN_UPDATE_TIME);
        }

        (uint256 currentValue, bool isUpdating) = _getAmplificationParameter();
        if (isUpdating) {
            revert AmplificationOngoingUpdate();
        }

        // daily rate = (endValue / currentValue) / duration * 1 day
        // We perform all multiplications first to not reduce precision, and round the division up as we want to avoid
        // large rates. Note that these are regular integer multiplications and divisions, not fixed point.
        uint256 dailyRate = endValue > currentValue
            ? Math.divUp(1 days * endValue, currentValue * duration)
            : Math.divUp(1 days * currentValue, endValue * duration);
        if (dailyRate > MAX_AMP_UPDATE_DAILY_RATE) {
            revert AmplificationUpdateDailyRateTooBig(dailyRate, MAX_AMP_UPDATE_DAILY_RATE);
        }

        _setAmplificationData(currentValue, endValue, block.timestamp, endTime);

        emit AmpUpdateStarted(currentValue, endValue, block.timestamp, endTime);
    }

    function stopAmplificationParameterUpdate() external override onlyOwner {
        (uint256 currentValue, bool isUpdating) = _getAmplificationParameter();
        if (!isUpdating) {
            revert NoAmplificationValueOngoingUpdate();
        }

        _setAmplificationData(currentValue, currentValue, block.timestamp, block.timestamp);

        emit AmpUpdateStopped(currentValue);
    }

    function setSwapFeePercentage(uint256 newSwapFeePercentage) external override onlyOwner {
        if (newSwapFeePercentage > MAX_SWAP_FEE_PERCENTAGE) {
            revert SwapFeeTooBig(newSwapFeePercentage, MAX_SWAP_FEE_PERCENTAGE);
        }
        swapFeePercentage = newSwapFeePercentage;

        emit SwapFeePercentageChanged(newSwapFeePercentage);
    }

    function getAmplificationParameter()
        external
        view
        override
        returns (
            uint256 value,
            bool isUpdating,
            uint256 precision
        )
    {
        (value, isUpdating) = _getAmplificationParameter();
        precision = StableMath._AMP_PRECISION;
    }

    function _getAmplificationParameter() private view returns (uint256 value, bool isUpdating) {
        (uint256 startValue, uint256 endValue, uint256 startTime, uint256 endTime) = getAmplificationData();

        // Note that block.timestamp >= startTime, since startTime is set to the current time when an update starts
        isUpdating = block.timestamp < endTime;

        value = _calculateAmplification(startValue, endValue, startTime, endTime);
    }

    function _getAmplificationValue() private view returns (uint256) {
        (uint256 startValue, uint256 endValue, uint256 startTime, uint256 endTime) = getAmplificationData();
        return _calculateAmplification(startValue, endValue, startTime, endTime);
    }

    function _calculateAmplification(
        uint256 startValue,
        uint256 endValue,
        uint256 startTime,
        uint256 endTime
    ) private view returns (uint256) {
        if (block.timestamp < endTime) {
            // We can skip checked arithmetic as:
            //  - block.timestamp is always larger or equal to startTime
            //  - endTime is always larger than startTime
            //  - the value delta is bounded by the largest amplification paramater, which never causes the
            //    multiplication to overflow.
            // This also means that the following computation will never revert nor yield invalid results.
            unchecked {
                if (endValue > startValue) {
                    return
                        startValue + ((endValue - startValue) * (block.timestamp - startTime)) / (endTime - startTime);
                } else {
                    return
                        startValue - ((startValue - endValue) * (block.timestamp - startTime)) / (endTime - startTime);
                }
            }
        } else {
            return endValue;
        }
    }

    function _setAmplificationData(
        uint256 startValue,
        uint256 endValue,
        uint256 startTime,
        uint256 endTime
    ) private {
        assert(
            startValue <= type(uint64).max &&
                endValue <= type(uint64).max &&
                startTime <= type(uint64).max &&
                endTime <= type(uint64).max
        );

        // Here we use inline assembly to save amount of sstores
        // AmplificationData fits one storage slot, so we use inline assembly to update it with only one sstore
        // solhint-disable-next-line no-inline-assembly
        assembly {
            let value := or(or(shl(192, startValue), shl(128, endValue)), or(shl(64, startTime), endTime))
            sstore(amplificationData.slot, value)
        }
    }

    function getAmplificationData()
        private
        view
        returns (
            uint256 startValue,
            uint256 endValue,
            uint256 startTime,
            uint256 endTime
        )
    {
        // Here we use inline assembly to save amount of sloads
        // AmplificationData fits one storage slot, so we use inline assembly to read it with only one sload
        // solhint-disable-next-line no-inline-assembly
        assembly {
            let mask := 0x000000000000000000000000000000000000000000000000000000000FFFFFFFFFFFFFFFF
            let value := sload(amplificationData.slot)
            startValue := and(shr(192, value), mask)
            endValue := and(shr(128, value), mask)
            startTime := and(shr(64, value), mask)
            endTime := and(value, mask)
        }
    }

    // Helpers

    function selfBalance0() private view returns (uint256) {
        return token0.balanceOf(address(this));
    }

    function selfBalance1() private view returns (uint256) {
        return token1.balanceOf(address(this));
    }

    function getRateAdjustedAmounts(
        uint256 amount0,
        uint256 amount1,
        uint256 rate0,
        uint256 rate1
    ) private view returns (uint256, uint256) {
        return (
            amount0.mulDown(scalingFactor).mulfV(rate0, TEMPUS_SHARE_PRECISION),
            amount1.mulDown(scalingFactor).mulfV(rate1, TEMPUS_SHARE_PRECISION)
        );
    }

    function getRateAdjustedBalances() private returns (uint256 balance0, uint256 balance1) {
        (balance0, balance1) = getUpscaledBalances();
        (balance0, balance1) = (
            balance0.mulfV(token0.getPricePerFullShare(), TEMPUS_SHARE_PRECISION),
            balance1.mulfV(token1.getPricePerFullShareStored(), TEMPUS_SHARE_PRECISION)
        );
    }

    function getRateAdjustedBalancesStored() private view returns (uint256 balance0, uint256 balance1) {
        (balance0, balance1) = getUpscaledBalances();
        (balance0, balance1) = (
            balance0.mulfV(token0.getPricePerFullShareStored(), TEMPUS_SHARE_PRECISION),
            balance1.mulfV(token1.getPricePerFullShareStored(), TEMPUS_SHARE_PRECISION)
        );
    }

    function getUpscaledBalances() private view returns (uint256 balance0, uint256 balance1) {
        (balance0, balance1) = (selfBalance0().mulDown(scalingFactor), selfBalance1().mulDown(scalingFactor));
    }

    function addSwapFeeAmount(uint256 amount) private view returns (uint256) {
        // This returns amount + fee amount, so we round up (favoring a higher fee amount).
        return amount.divUp(Fixed256x18.ONE - swapFeePercentage);
    }

    function subtractSwapFeeAmount(uint256 amount) private view returns (uint256) {
        // This returns amount - fee amount, so we round up (favoring a higher fee amount).
        uint256 feeAmount = amount.mulUp(swapFeePercentage);
        return amount - feeAmount;
    }

    // Pausability

    function pause() external override onlyOwner {
        _pause();
    }

    function unpause() external override onlyOwner {
        _unpause();
    }
}
