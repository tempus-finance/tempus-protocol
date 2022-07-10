// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.10;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@tempus-labs/contracts/utils/UntrustedERC20.sol";
import "@tempus-labs/contracts/math/Fixed256xVar.sol";

import "./ITempusController.sol";
import "./IPositionManager.sol";

contract PositionManager is IPositionManager, ERC721, ReentrancyGuard {
    using Fixed256xVar for uint256;
    using SafeERC20 for IERC20Metadata;
    using UntrustedERC20 for IERC20Metadata;

    ITempusController public immutable controller;
    mapping(uint256 => Position) private _positions;
    uint256 private _nextId = 1;

    // solhint-disable-next-line no-empty-blocks
    constructor(
        address tempusController,
        string memory name,
        string memory symbol
    ) ERC721(name, symbol) {
        if (tempusController == address(0)) {
            revert InvalidTempusController();
        }
        controller = ITempusController(tempusController);
    }

    function mint(MintParams calldata params) external payable override nonReentrant returns (uint256 tokenId) {
        ITempusPool tempusPool = params.tempusAMM.token0().pool();
        if (tempusPool != params.tempusAMM.token1().pool()) {
            revert AmmSharesPoolMismatch();
        }

        uint256 tokenAmountToDeposit = msg.value;
        {
            IERC20Metadata depositedAsset = params.isBackingToken
                ? tempusPool.backingToken()
                : tempusPool.yieldBearingToken();

            if (address(depositedAsset) == address(0)) {
                if (tokenAmountToDeposit != params.tokenAmountToDeposit) {
                    revert EtherDepositMismatch();
                }
            } else {
                tokenAmountToDeposit = depositedAsset.untrustedTransferFrom(
                    msg.sender,
                    address(this),
                    params.tokenAmountToDeposit
                );
                depositedAsset.safeIncreaseAllowance(address(controller), tokenAmountToDeposit);
            }
        }

        uint256 capitalsReceived;
        uint256 yieldsReceived;
        uint256 mintedShares;
        if (params.leverageMultiplier == 0) {
            uint256 backingTokenONE = tempusPool.backingTokenONE();
            (mintedShares, capitalsReceived) = controller.depositAndFix{value: msg.value}(
                params.tempusAMM,
                tempusPool,
                tokenAmountToDeposit,
                params.isBackingToken,
                backingTokenONE.divfV(params.worstAcceptableCapitalsRate, backingTokenONE),
                params.deadline
            );
        } else if (params.leverageMultiplier > 1e18) {
            (mintedShares, capitalsReceived, yieldsReceived) = controller.depositAndLeverage{value: msg.value}(
                params.tempusAMM,
                tempusPool,
                params.leverageMultiplier,
                tokenAmountToDeposit,
                params.isBackingToken,
                params.worstAcceptableCapitalsRate,
                params.deadline
            );
        } else {
            revert InvalidLeverageMultiplier();
        }

        tokenId = _nextId++;
        _positions[tokenId] = Position({
            capitals: SafeCast.toUint128(capitalsReceived),
            yields: SafeCast.toUint128(yieldsReceived),
            tempusAMM: params.tempusAMM
        });
        _safeMint(params.recipient, tokenId, abi.encode(mintedShares));

        emit Minted(
            msg.sender,
            params.recipient,
            params.tempusAMM,
            tokenId,
            params.leverageMultiplier,
            params.tokenAmountToDeposit,
            params.isBackingToken,
            mintedShares,
            capitalsReceived,
            yieldsReceived
        );
    }

    function burn(uint256 tokenId, BurnParams calldata params)
        external
        override
        nonReentrant
        returns (uint256 liquidatedTokenAmount)
    {
        if (!_isApprovedOrOwner(msg.sender, tokenId)) {
            revert UnauthorizedBurn();
        }

        Position memory p = _positions[tokenId];

        delete _positions[tokenId];
        _burn(tokenId);

        ITempusPool tempusPool = p.tempusAMM.token0().pool();
        liquidatedTokenAmount = _liquidatePosition(p.tempusAMM, tempusPool, p.capitals, p.yields, params);

        emit Burned(msg.sender, params.recipient, tokenId, liquidatedTokenAmount, params.toBackingToken);
    }

    function position(uint256 tokenId) external view override returns (Position memory) {
        return _positions[tokenId];
    }

    function _liquidatePosition(
        ITempusAMM amm,
        ITempusPool tempusPool,
        uint128 capitals,
        uint128 yields,
        BurnParams calldata params
    ) private returns (uint256 liquidatedTokenAmount) {
        tempusPool.principalShare().approve(address(controller), capitals);
        tempusPool.yieldShare().approve(address(controller), yields);
        liquidatedTokenAmount = controller.exitAmmGivenLpAndRedeem(
            amm,
            tempusPool,
            new ERC20PermitSignature[](0), // no permits, we approved tokens already
            0, // lpTokens is 0 since LP tokens are not supported by the PositionManager
            capitals,
            yields,
            ExitAMMGivenLPSlippageParams(
                0, // minPrincipalsStaked is 0 since LP tokens are not supported by the PositionManager
                0, // minYieldsStaked is 0 since LP tokens are not supported by the PositionManager
                params.maxLeftoverShares,
                params.yieldsRate,
                params.maxSlippage
            ),
            params.toBackingToken,
            params.deadline
        );

        if (params.toBackingToken) {
            tempusPool.backingToken().safeTransfer(params.recipient, liquidatedTokenAmount);
        } else {
            tempusPool.yieldBearingToken().safeTransfer(params.recipient, liquidatedTokenAmount);
        }
    }
}
