// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.10;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";

import "./ITempusController.sol";
import "./IPositionManager.sol";
import "./utils/UntrustedERC20.sol";
import "./math/Fixed256xVar.sol";

contract PositionManager is IPositionManager, ERC721, ReentrancyGuard {
    using Fixed256xVar for uint256;
    using SafeERC20 for IERC20;
    using UntrustedERC20 for IERC20;

    mapping(uint256 => Position) private _positions;
    uint256 private _nextId = 1;

    // solhint-disable-next-line no-empty-blocks
    constructor(string memory name, string memory symbol) ERC721(name, symbol) {}

    function mint(MintParams calldata params) external payable override nonReentrant returns (uint256 tokenId) {
        ITempusPool tempusPool = params.tempusAMM.token0().pool();
        if (tempusPool != params.tempusAMM.token1().pool()) {
            revert AmmSharesPoolMismatch();
        }

        address controller = tempusPool.controller();

        uint256 tokenAmountToDeposit = msg.value;
        {
            address depositedAsset = params.isBackingToken ? tempusPool.backingToken() : tempusPool.yieldBearingToken();

            if (depositedAsset != address(0)) {
                tokenAmountToDeposit = IERC20(depositedAsset).untrustedTransferFrom(
                    msg.sender,
                    address(this),
                    params.tokenAmountToDeposit
                );
                IERC20(depositedAsset).safeIncreaseAllowance(controller, tokenAmountToDeposit);
            }
        }

        uint256 capitalsMinted;
        uint256 yieldsMinted;
        if (params.leverageMultiplier == 0) {
            uint256 backingTokenONE = tempusPool.backingTokenONE();
            capitalsMinted = ITempusController(controller).depositAndFix{value: msg.value}(
                params.tempusAMM,
                tempusPool,
                tokenAmountToDeposit,
                params.isBackingToken,
                backingTokenONE.divfV(params.worstAcceptableCapitalsRate, backingTokenONE),
                params.deadline
            );
        } else if (params.leverageMultiplier > 1e18) {
            (capitalsMinted, yieldsMinted) = ITempusController(controller).depositAndLeverage{value: msg.value}(
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
            capitals: SafeCast.toUint128(capitalsMinted),
            yields: SafeCast.toUint128(yieldsMinted),
            tempusAMM: params.tempusAMM
        });

        _safeMint(params.recipient, tokenId);
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
        address controller = tempusPool.controller();
        IERC20(address(tempusPool.principalShare())).approve(controller, capitals);
        IERC20(address(tempusPool.yieldShare())).approve(controller, yields);
        liquidatedTokenAmount = ITempusController(controller).exitAmmGivenLpAndRedeem(
            amm,
            tempusPool,
            0, // lpTokens is 0 since LP tokens are not supported by the PositionManager
            capitals,
            yields,
            0, // minPrincipalsStaked is 0 since LP tokens are not supported by the PositionManager
            0, // minYieldsStaked is 0 since LP tokens are not supported by the PositionManager
            params.maxLeftoverShares,
            params.yieldsRate,
            params.maxSlippage,
            params.toBackingToken,
            params.deadline
        );

        if (params.toBackingToken) {
            IERC20(tempusPool.backingToken()).safeTransfer(params.recipient, liquidatedTokenAmount);
        } else {
            IERC20(tempusPool.yieldBearingToken()).safeTransfer(params.recipient, liquidatedTokenAmount);
        }
    }
}
