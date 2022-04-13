// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.10;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

import "./ITempusOTC.sol";
import "../ITempusPool.sol";
import "../utils/Ownable.sol";
import "../utils/UntrustedERC20.sol";

contract TempusOTC is ITempusOTC, ReentrancyGuard, Ownable {
    using UntrustedERC20 for IERC20;

    ITempusPool public immutable tempusPool;

    OfferStatus public offerStatus;
    address public yieldReceiver;
    uint256 public principalSetOfferAmount;
    uint256 public yieldRequestedAmount;

    constructor(ITempusPool pool) {
        tempusPool = pool;
        offerStatus = OfferStatus.NotSet;
    }

    /// @inheritdoc ITempusOTC
    function setOffer(
        uint256 tokenAmount,
        bool isBackingToken,
        uint256 requestYieldAmount,
        address recipient
    ) external payable onlyOwner returns (uint256) {
        if (offerStatus != OfferStatus.NotSet) {
            revert OfferAlreadySet();
        }

        uint256 mintedShares = isBackingToken ? _depositBacking(tokenAmount) : _depositYieldBearing(tokenAmount);

        _fillOfferDetails(recipient, OfferStatus.Created, mintedShares, requestYieldAmount);

        IERC20 yieldShares = IERC20(address(tempusPool.yieldShare()));
        yieldShares.transfer(recipient, mintedShares);

        return mintedShares;
    }

    /// @inheritdoc ITempusOTC
    function cancelOffer(address recipient) external onlyOwner returns (uint256) {
        if (offerStatus != OfferStatus.Created) {
            revert OfferNotCreated();
        }

        uint256 principalLockedAmount = principalSetOfferAmount;

        _fillOfferDetails(address(0), OfferStatus.NotSet, 0, 0);

        IERC20 principalShares = IERC20(address(tempusPool.principalShare()));
        principalShares.transfer(recipient, principalLockedAmount);

        return principalLockedAmount;
    }

    /// @inheritdoc ITempusOTC
    function acceptOffer(
        uint256 tokenAmount,
        bool isBackingToken,
        address recipient
    ) external payable nonReentrant returns (uint256 principalAmount, uint256 yieldAmount) {
        if (offerStatus != OfferStatus.Created) {
            revert OfferNotCreated();
        }

        if (tempusPool.getSharesAmountForExactTokensOut(tokenAmount, isBackingToken) < yieldRequestedAmount) {
            revert NoEnoughSharesToAcceptOffer();
        }

        uint256 mintedShares = isBackingToken ? _depositBacking(tokenAmount) : _depositYieldBearing(tokenAmount);

        offerStatus = OfferStatus.Accepted;

        principalAmount = mintedShares + principalSetOfferAmount;
        IERC20 principalShares = IERC20(address(tempusPool.principalShare()));
        principalShares.transfer(recipient, principalAmount);

        yieldAmount = mintedShares - yieldRequestedAmount;
        IERC20 yieldShares = IERC20(address(tempusPool.yieldShare()));
        yieldShares.transfer(recipient, yieldAmount);
    }

    /// @inheritdoc ITempusOTC
    function withdrawYieldAfterOfferAccepted(uint256 tokenAmount) external {
        if (offerStatus != OfferStatus.Accepted) {
            revert OfferNotAccepted();
        }

        if (msg.sender != yieldReceiver) {
            revert YieldReceiverIsNotSameAsMsgSender();
        }

        IERC20 yieldShares = IERC20(address(tempusPool.yieldShare()));
        if (tokenAmount > yieldShares.balanceOf(address(this))) {
            revert NoEnoughYieldSharesToWithdraw();
        }

        yieldShares.transfer(msg.sender, tokenAmount);
    }

    /// @inheritdoc ITempusOTC
    function redeem(
        uint256 principals,
        uint256 yields,
        address recipient,
        bool isBackingToken
    ) external nonReentrant returns (uint256) {
        if (principals == 0 && yields == 0) {
            revert ZeroPrincipalAndYieldAmounts();
        }

        return
            isBackingToken
                ? _redeemToBacking(msg.sender, principals, yields, recipient)
                : _redeemToYieldBearing(msg.sender, principals, yields, recipient);
    }

    function _depositYieldBearing(uint256 yieldTokenAmount) private returns (uint256) {
        if (yieldTokenAmount == 0) {
            revert ZeroYieldTokenAmount();
        }

        IERC20 yieldBearingToken = IERC20(tempusPool.yieldBearingToken());

        // Transfer funds from msg.sender to tempusPool
        uint256 transferredYBT = yieldBearingToken.untrustedTransferFrom(
            msg.sender,
            address(tempusPool),
            yieldTokenAmount
        );

        (uint256 mintedShares, uint256 depositedBT, uint256 fee, uint256 rate) = tempusPool.onDepositYieldBearing(
            transferredYBT,
            address(this)
        );

        emit DepositedOTC(tempusPool, msg.sender, address(this), transferredYBT, depositedBT, mintedShares, rate, fee);

        return mintedShares;
    }

    function _depositBacking(uint256 _backingTokenAmount) private returns (uint256) {
        if (_backingTokenAmount == 0) {
            revert ZeroBackingTokenAmount();
        }

        IERC20 backingToken = IERC20(tempusPool.backingToken());

        // In case the underlying pool expects deposits in Ether (e.g. Lido),
        // it uses `backingToken = address(0)`.  Since we disallow 0-value deposits,
        // and `msg.value == backingTokenAmount`, this check here can be used to
        // distinguish between the two pool types.
        if (msg.value == 0) {
            // NOTE: We need to have this check here to avoid calling transfer on address(0),
            //       because that always succeeds.
            if (address(backingToken) == address(0)) {
                revert ZeroAddressBackingToken();
            }

            _backingTokenAmount = backingToken.untrustedTransferFrom(
                msg.sender,
                address(tempusPool),
                _backingTokenAmount
            );
        } else {
            if (address(backingToken) != address(0)) {
                revert NonZeroAddressBackingToken();
            }
            if (msg.value != _backingTokenAmount) {
                revert EtherValueAndBackingTokenAmountMismatch(msg.value, _backingTokenAmount);
            }
        }

        (uint256 mintedShares, uint256 depositedYBT, uint256 fee, uint256 interestRate) = tempusPool.onDepositBacking{
            value: msg.value
        }(_backingTokenAmount, address(this));

        emit DepositedOTC(
            tempusPool,
            msg.sender,
            address(this),
            depositedYBT,
            _backingTokenAmount,
            mintedShares,
            interestRate,
            fee
        );

        return mintedShares;
    }

    function _redeemToYieldBearing(
        address sender,
        uint256 principals,
        uint256 yields,
        address recipient
    ) private returns (uint256) {
        (uint256 redeemedYBT, uint256 fee, uint256 interestRate) = tempusPool.redeem(
            sender,
            principals,
            yields,
            recipient
        );

        uint256 redeemedBT = tempusPool.numAssetsPerYieldToken(redeemedYBT, tempusPool.currentInterestRate());
        bool earlyRedeem = !tempusPool.matured();
        emit RedeemedOTC(
            tempusPool,
            sender,
            recipient,
            principals,
            yields,
            redeemedYBT,
            redeemedBT,
            interestRate,
            fee,
            earlyRedeem
        );

        return redeemedYBT;
    }

    function _redeemToBacking(
        address sender,
        uint256 principals,
        uint256 yields,
        address recipient
    ) private returns (uint256) {
        (uint256 redeemedYBT, uint256 redeemedBT, uint256 fee, uint256 rate) = tempusPool.redeemToBacking(
            sender,
            principals,
            yields,
            recipient
        );

        bool earlyRedeem = !tempusPool.matured();
        emit RedeemedOTC(
            tempusPool,
            sender,
            recipient,
            principals,
            yields,
            redeemedYBT,
            redeemedBT,
            rate,
            fee,
            earlyRedeem
        );

        return redeemedBT;
    }

    function _fillOfferDetails(
        address _yieldReceiver,
        OfferStatus _offerStatus,
        uint256 _principalSetOfferAmount,
        uint256 _yieldRequestedAmount
    ) private {
        yieldReceiver = _yieldReceiver;
        offerStatus = _offerStatus;
        principalSetOfferAmount = _principalSetOfferAmount;
        yieldRequestedAmount = _yieldRequestedAmount;
    }
}
