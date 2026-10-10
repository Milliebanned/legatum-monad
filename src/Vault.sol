// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @dev Implemented by VaultFactory: lets a vault it created report
///      beneficiaries added after creation.
interface IVaultRegistry {
    function registerBeneficiaries(address[] calldata beneficiaries) external;
}

/// @title Vault
/// @notice Non-custodial dead-man's-switch vault for MON and ERC-20 tokens.
///         One owner, up to MAX_BENEFICIARIES beneficiaries, each entitled to
///         a percentage (in basis points) of every asset the vault holds once
///         the owner stops checking in. When the timer runs out, distribute()
///         sends every share straight to the beneficiaries' wallets; nobody
///         has to claim. The owner can change the beneficiary list while the
///         vault is active.
///         Deployed once as an implementation contract and reused via minimal
///         proxy clones (see VaultFactory). Monad only.
contract Vault is ReentrancyGuard {
    enum State {
        Active, // owner is checking in
        // Deadline passed; waiting for distribute(). Never stored: a lapsed
        // vault stays Active in storage (so nobody but the owner can change
        // what the owner may do with it) and getVaultState() reports Due.
        Due,
        Distributed, // shares sent to beneficiaries
        Cancelled // owner took the funds back
    }

    // One on-chain history entry per owner/beneficiary action, so a frontend
    // can show a vault's activity without an indexer.
    enum Action {
        Created, // amount = 0
        BeneficiariesSet, // amount = number of beneficiaries
        Deposit, // amount of `token` deposited
        Withdraw, // amount of `token` withdrawn
        CheckIn, // amount = 0
        Payout, // amount of `token` sent to beneficiary `actor`
        PayoutFailed, // amount of `token` held for `actor` after their transfer failed
        Cancel // amount of `token` returned to the owner
    }

    struct HistoryEntry {
        Action action;
        uint64 timestamp;
        address actor;
        address token; // NATIVE for MON and for entries that move nothing
        uint256 amount;
    }

    // Monad mainnet and testnet. Never configurable, never overridden.
    uint256 public constant CHAIN_ID = 143;
    uint256 public constant TESTNET_CHAIN_ID = 10143;

    // Stands for MON wherever a token address is expected.
    address public constant NATIVE = address(0);

    uint256 public constant MAX_BENEFICIARIES = 10;
    // ERC-20 tokens one vault can hold, besides MON. Together with
    // MAX_BENEFICIARIES this bounds the work distribute() does.
    uint256 public constant MAX_TOKENS = 8;
    uint256 public constant TOTAL_SHARES = 10_000; // basis points: 10_000 = 100%
    uint256 public constant MAX_NAME_LENGTH = 64; // bytes
    // Upper bounds on the timer. Beyond being sane, they keep
    // lastCheckInTime + interval + grace far from overflow, so deadlineTime()
    // and every view built on it can never revert.
    uint256 public constant MAX_CHECK_IN_INTERVAL = 3650 days;
    // Lower bound on the timer. A window of seconds would hand a vault to its
    // beneficiaries almost as soon as it was funded, and would let anyone
    // mass-produce instantly-due vaults for payout keepers to waste gas on.
    uint256 public constant MIN_CHECK_IN_INTERVAL = 1 days;
    uint256 public constant MAX_GRACE_PERIOD = 365 days;
    // Gas handed to a beneficiary when paying out MON. Plenty for a wallet or
    // a smart account's receive hook, too little for one beneficiary to burn
    // the gas the others' payouts need.
    uint256 public constant NATIVE_PAYOUT_GAS = 50_000;

    // The factory that cloned this vault. Told about beneficiaries added
    // later so its by-beneficiary index stays complete.
    address public factory;

    address public owner;
    string public name;
    uint256 public checkInInterval;
    uint256 public gracePeriod;
    uint256 public lastCheckInTime;
    State public state;
    bool public initialized;

    address[] internal beneficiaryList;
    mapping(address => uint256) public shareOf; // basis points; 0 = not a beneficiary

    // ERC-20 tokens the owner has deposited. MON is always paid out and is
    // not listed. Only the owner adds to this, so tokens a stranger sends in
    // can't grow the payout loop.
    address[] internal tokenList;
    mapping(address => bool) public isTracked;

    // Per token: what has been split among beneficiaries so far.
    mapping(address => uint256) public distributedPool;
    // A share whose transfer failed (e.g. a blacklisted address, or a
    // contract that refuses MON) is held here, per token, for that person to
    // withdraw later, so one bad address can't block everyone else's payout.
    mapping(address => mapping(address => uint256)) public owed; // token => person => amount
    mapping(address => uint256) public owedTotal; // token => sum of owed

    HistoryEntry[] internal history;

    event Initialized(
        address indexed owner,
        string name,
        address[] beneficiaries,
        uint256[] shares,
        uint256 checkInInterval,
        uint256 gracePeriod
    );
    event CheckedIn(address indexed owner, uint256 newDeadline);
    event Deposited(address indexed owner, address indexed token, uint256 amount);
    event Received(address indexed from, uint256 amount);
    event Withdrawn(address indexed owner, address indexed token, uint256 amount);
    event Distributed(address indexed caller);
    event Paid(address indexed beneficiary, address indexed token, uint256 amount);
    event PayoutFailed(address indexed beneficiary, address indexed token, uint256 amount);
    event OwedWithdrawn(address indexed beneficiary, address indexed token, uint256 amount);
    event Cancelled(address indexed owner);
    event BeneficiariesUpdated(address[] beneficiaries, uint256[] shares);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    modifier onlyActive() {
        require(state == State.Active, "Vault not active");
        _;
    }

    constructor() {
        require(block.chainid == CHAIN_ID || block.chainid == TESTNET_CHAIN_ID, "Monad only");

        // Lock the implementation contract itself so initialize() can never be
        // called directly on it — only on clones, which start uninitialized.
        initialized = true;
    }

    /// @dev Initialize a clone (called once by the factory right after cloning).
    ///      Any MON sent along is the owner's first deposit.
    /// @param _shares Basis points per beneficiary, same order as _beneficiaries.
    ///        Each must be > 0 and together they must sum to TOTAL_SHARES.
    function initialize(
        address _owner,
        string calldata _name,
        address[] calldata _beneficiaries,
        uint256[] calldata _shares,
        uint256 _checkInInterval,
        uint256 _gracePeriod
    ) external payable {
        require(!initialized, "Already initialized");
        require(_owner != address(0), "Invalid owner");
        require(bytes(_name).length <= MAX_NAME_LENGTH, "Name too long");
        require(_checkInInterval >= MIN_CHECK_IN_INTERVAL, "Interval too short");
        require(_checkInInterval <= MAX_CHECK_IN_INTERVAL, "Interval too long");
        require(_gracePeriod <= MAX_GRACE_PERIOD, "Grace period too long");

        owner = _owner;
        factory = msg.sender;
        _record(Action.Created, _owner, NATIVE, 0);
        _setBeneficiaries(_owner, _beneficiaries, _shares);

        name = _name;
        checkInInterval = _checkInInterval;
        gracePeriod = _gracePeriod;
        lastCheckInTime = block.timestamp;
        state = State.Active;
        initialized = true;

        emit Initialized(_owner, _name, _beneficiaries, _shares, _checkInInterval, _gracePeriod);

        if (msg.value > 0) {
            _record(Action.Deposit, _owner, NATIVE, msg.value);
            emit Deposited(_owner, NATIVE, msg.value);
        }
    }

    /// @dev Deposit MON (token = NATIVE, amount = msg.value) or an ERC-20 the
    ///      owner has approved this vault for. A token's first deposit adds
    ///      it to the list of assets paid out.
    function deposit(address token, uint256 amount) external payable onlyOwner onlyActive nonReentrant {
        require(amount > 0, "Amount must be > 0");
        if (token == NATIVE) {
            require(msg.value == amount, "Value mismatch");
        } else {
            require(msg.value == 0, "MON sent with token");
            if (!isTracked[token]) {
                require(token.code.length > 0, "Not a token");
                require(tokenList.length < MAX_TOKENS, "Too many tokens");
                isTracked[token] = true;
                tokenList.push(token);
            }
            require(IERC20(token).transferFrom(msg.sender, address(this), amount), "Transfer failed");
        }
        _record(Action.Deposit, msg.sender, token, amount);
        emit Deposited(owner, token, amount);
    }

    /// @dev MON sent straight to the vault's address. From the owner it is a
    ///      deposit like any other; from anyone else it simply joins the
    ///      balance.
    receive() external payable {
        if (msg.sender == owner && state == State.Active) {
            _record(Action.Deposit, msg.sender, NATIVE, msg.value);
            emit Deposited(owner, NATIVE, msg.value);
        } else {
            emit Received(msg.sender, msg.value);
        }
    }

    /// @dev Owner replaces the whole beneficiary list (add, remove, or
    ///      re-weight people) while the vault is active. Same rules as at
    ///      creation. Not possible once the vault is distributed or cancelled.
    function setBeneficiaries(
        address[] calldata _beneficiaries,
        uint256[] calldata _shares
    ) external onlyOwner onlyActive nonReentrant {
        for (uint256 i = 0; i < beneficiaryList.length; i++) {
            shareOf[beneficiaryList[i]] = 0;
        }
        delete beneficiaryList;
        _setBeneficiaries(owner, _beneficiaries, _shares);
        IVaultRegistry(factory).registerBeneficiaries(_beneficiaries);
    }

    function _setBeneficiaries(
        address _owner,
        address[] calldata _beneficiaries,
        uint256[] calldata _shares
    ) internal {
        require(
            _beneficiaries.length > 0 && _beneficiaries.length <= MAX_BENEFICIARIES,
            "1 to 10 beneficiaries"
        );
        require(_beneficiaries.length == _shares.length, "Shares length mismatch");

        uint256 total;
        for (uint256 i = 0; i < _beneficiaries.length; i++) {
            address b = _beneficiaries[i];
            // A share sent to this vault or the factory could never be moved
            // again.
            require(b != address(0) && b != address(this) && b != factory, "Invalid beneficiary");
            require(b != _owner, "Beneficiary cannot be owner");
            require(shareOf[b] == 0, "Duplicate beneficiary");
            require(_shares[i] > 0, "Share must be > 0");
            shareOf[b] = _shares[i];
            beneficiaryList.push(b);
            total += _shares[i];
        }
        require(total == TOTAL_SHARES, "Shares must total 100%");

        _record(Action.BeneficiariesSet, _owner, NATIVE, _beneficiaries.length);
        emit BeneficiariesUpdated(_beneficiaries, _shares);
    }

    function _record(Action action, address actor, address token, uint256 amount) internal {
        history.push(HistoryEntry(action, uint64(block.timestamp), actor, token, amount));
    }

    /// @dev Owner checks in to prove they're still active and reset the deadline.
    ///      Works after the deadline too, as long as the vault hasn't been
    ///      distributed yet.
    function checkIn() external onlyOwner onlyActive nonReentrant {
        lastCheckInTime = block.timestamp;
        _record(Action.CheckIn, msg.sender, NATIVE, 0);
        emit CheckedIn(owner, block.timestamp + checkInInterval + gracePeriod);
    }

    /// @dev Deadline after which the vault can be distributed.
    function deadlineTime() public view returns (uint256) {
        return lastCheckInTime + checkInInterval + gracePeriod;
    }

    /// @dev True once the deadline has passed and the vault hasn't been
    ///      distributed or cancelled — i.e. distribute() would succeed. What
    ///      an automated keeper polls.
    function isDue() public view returns (bool) {
        return state == State.Active && block.timestamp > deadlineTime();
    }

    /// @dev Sends every beneficiary their share of MON and of every deposited
    ///      token straight to their wallet once the deadline has passed.
    ///      Callable by anyone — normally an automated keeper the moment the
    ///      timer runs out, but a beneficiary or anyone else can call it too,
    ///      so payout never depends on one service. The last beneficiary's
    ///      share absorbs rounding dust. A transfer that fails is recorded in
    ///      `owed` for withdrawOwed() instead of reverting the whole payout.
    function distribute() external nonReentrant {
        require(isDue(), "Not due yet");

        // effects before interactions
        state = State.Distributed;
        emit Distributed(msg.sender);

        _payOut(NATIVE, true);
        uint256 n = tokenList.length;
        for (uint256 i = 0; i < n; i++) {
            _payOut(tokenList[i], true);
        }
    }

    /// @dev After distribution, splits whatever the vault holds of `token`
    ///      the same way: for MON or tokens that arrived late, or a token the
    ///      owner was sent but never deposited through deposit(). Callable by
    ///      anyone.
    function distributeToken(address token) external nonReentrant {
        require(state == State.Distributed, "Not distributed");
        // Tokens the owner never deposited stay out of the vault's history,
        // so nobody can fill it with entries for worthless ones.
        _payOut(token, token == NATIVE || isTracked[token]);
    }

    function _payOut(address token, bool recorded) internal {
        // Shares already held for someone are theirs, not part of the pool.
        uint256 held = _balanceOf(token);
        uint256 reserved = owedTotal[token];
        if (held <= reserved) return;
        uint256 pool = held - reserved;
        distributedPool[token] += pool;

        uint256 n = beneficiaryList.length;
        uint256 allocated;
        for (uint256 i = 0; i < n; i++) {
            address b = beneficiaryList[i];
            uint256 amount = i == n - 1 ? pool - allocated : (pool * shareOf[b]) / TOTAL_SHARES;
            allocated += amount;
            if (amount == 0) continue;

            if (_trySend(token, b, amount)) {
                if (recorded) _record(Action.Payout, b, token, amount);
                emit Paid(b, token, amount);
            } else {
                owed[token][b] += amount;
                owedTotal[token] += amount;
                if (recorded) _record(Action.PayoutFailed, b, token, amount);
                emit PayoutFailed(b, token, amount);
            }
        }
    }

    /// @dev Whoever is owed `token` after a failed transfer retries it here,
    ///      once whatever blocked it is resolved.
    function withdrawOwed(address token) external nonReentrant {
        uint256 amount = owed[token][msg.sender];
        require(amount > 0, "Nothing owed");
        owed[token][msg.sender] = 0;
        owedTotal[token] -= amount;
        _record(Action.Payout, msg.sender, token, amount);
        _send(token, msg.sender, amount);
        emit OwedWithdrawn(msg.sender, token, amount);
    }

    // Balance read that can't revert, so a token that breaks later can't
    // stop the vault paying out everything else.
    function _balanceOf(address token) internal view returns (uint256) {
        if (token == NATIVE) return address(this).balance;
        (bool ok, bytes memory ret) = token.staticcall(abi.encodeCall(IERC20.balanceOf, (address(this))));
        if (!ok || ret.length != 32) return 0;
        return uint256(bytes32(ret));
    }

    // Transfer that must succeed: to the caller's own address, where a
    // failure should stop the call.
    function _send(address token, address to, uint256 amount) internal {
        if (token == NATIVE) {
            (bool ok, ) = to.call{value: amount}("");
            require(ok, "Transfer failed");
        } else {
            require(IERC20(token).transfer(to, amount), "Transfer failed");
        }
    }

    // Transfer that reports failure instead of reverting. For a token, a
    // revert, a false or malformed return, or a non-contract token all count
    // as failure. A caller can't fake a failure by starving the call of gas:
    // MON payouts check there is enough to hand over the full allowance, and
    // for a token the 1/64 of gas the EVM holds back is far less than
    // recording a failed payout costs, so a starved transfer takes the whole
    // call down with it.
    function _trySend(address token, address to, uint256 amount) internal returns (bool) {
        if (token == NATIVE) {
            require(gasleft() > NATIVE_PAYOUT_GAS + NATIVE_PAYOUT_GAS / 16, "Not enough gas");
            (bool sent, ) = to.call{value: amount, gas: NATIVE_PAYOUT_GAS}("");
            return sent;
        }
        (bool ok, bytes memory ret) = token.call(abi.encodeCall(IERC20.transfer, (to, amount)));
        if (!ok) return false;
        if (ret.length == 0) return token.code.length > 0;
        return ret.length == 32 && uint256(bytes32(ret)) == 1;
    }

    /// @dev Owner withdraws some or all of one asset while the vault is
    ///      active. Taking out the last of everything closes the vault: an
    ///      empty vault has nothing left to pass on, so it shouldn't go on
    ///      asking for check-ins.
    function withdraw(address token, uint256 amount) external onlyOwner onlyActive nonReentrant {
        require(amount > 0, "Amount must be > 0");
        require(_balanceOf(token) >= amount, "Insufficient balance");
        _record(Action.Withdraw, msg.sender, token, amount);
        _send(token, owner, amount);
        emit Withdrawn(owner, token, amount);

        if (_isEmpty()) {
            state = State.Cancelled;
            _record(Action.Cancel, msg.sender, NATIVE, 0);
            emit Cancelled(owner);
        }
    }

    // True when the vault holds no MON and none of any token its owner
    // deposited.
    function _isEmpty() internal view returns (bool) {
        if (address(this).balance > 0) return false;
        uint256 n = tokenList.length;
        for (uint256 i = 0; i < n; i++) {
            if (_balanceOf(tokenList[i]) > 0) return false;
        }
        return true;
    }

    /// @dev Owner cancels the vault and takes everything back. Terminal state.
    ///      An asset that can't be sent is left in `owed` for the owner to
    ///      collect with withdrawOwed(), so one broken token can't keep the
    ///      rest locked in.
    function cancel() external onlyOwner onlyActive nonReentrant {
        state = State.Cancelled;
        _refund(NATIVE);
        uint256 n = tokenList.length;
        for (uint256 i = 0; i < n; i++) {
            _refund(tokenList[i]);
        }
        emit Cancelled(owner);
    }

    function _refund(address token) internal {
        uint256 amount = _balanceOf(token);
        // MON always gets an entry, so a cancelled vault's history ends with one.
        if (amount == 0 && token != NATIVE) return;
        _record(Action.Cancel, owner, token, amount);
        if (amount == 0) return;
        if (!_trySend(token, owner, amount)) {
            owed[token][owner] += amount;
            owedTotal[token] += amount;
            emit PayoutFailed(owner, token, amount);
        }
    }

    /// @dev Every beneficiary and their share in basis points, in creation order.
    function getBeneficiaries()
        external
        view
        returns (address[] memory beneficiaries, uint256[] memory shares)
    {
        beneficiaries = beneficiaryList;
        shares = new uint256[](beneficiaries.length);
        for (uint256 i = 0; i < beneficiaries.length; i++) {
            shares[i] = shareOf[beneficiaries[i]];
        }
    }

    /// @dev ERC-20 tokens the owner has deposited, in order of first deposit.
    ///      MON is always held as well and is not listed.
    function getTokens() external view returns (address[] memory) {
        return tokenList;
    }

    /// @dev MON first, then every deposited token, each with the vault's
    ///      current balance.
    function getBalances() external view returns (address[] memory tokens, uint256[] memory balances) {
        uint256 n = tokenList.length;
        tokens = new address[](n + 1);
        balances = new uint256[](n + 1);
        balances[0] = address(this).balance;
        for (uint256 i = 0; i < n; i++) {
            tokens[i + 1] = tokenList[i];
            balances[i + 1] = _balanceOf(tokenList[i]);
        }
    }

    /// @dev Number of history entries.
    function historyLength() external view returns (uint256) {
        return history.length;
    }

    /// @dev History entries [from, from + count), oldest first, clamped to the end.
    function getHistory(uint256 from, uint256 count) external view returns (HistoryEntry[] memory entries) {
        uint256 end = from + count;
        if (end > history.length) end = history.length;
        if (from >= end) return new HistoryEntry[](0);
        entries = new HistoryEntry[](end - from);
        for (uint256 i = from; i < end; i++) {
            entries[i - from] = history[i];
        }
    }

    /// @dev Number of beneficiaries.
    function beneficiaryCount() external view returns (uint256) {
        return beneficiaryList.length;
    }

    /// @dev What `who` gets of `token` from this vault right now: their share
    ///      of the current balance before distribution, what they're owed
    ///      after it.
    function shareValue(address token, address who) external view returns (uint256) {
        if (state == State.Distributed || state == State.Cancelled) return owed[token][who];
        return (_balanceOf(token) * shareOf[who]) / TOTAL_SHARES;
    }

    /// @dev The vault's current balance of `token` (NATIVE for MON).
    function balanceOf(address token) external view returns (uint256) {
        return _balanceOf(token);
    }

    /// @dev Seconds remaining until the deadline. 0 if already past.
    function timeUntilDeadline() external view returns (uint256) {
        uint256 deadline = deadlineTime();
        if (block.timestamp >= deadline) {
            return 0;
        }
        return deadline - block.timestamp;
    }

    /// @dev Current vault state, recomputed as of now (does not write storage).
    ///      Useful for frontends that want the live state without sending a tx.
    function getVaultState() external view returns (State) {
        if (state == State.Active && block.timestamp > deadlineTime()) {
            return State.Due;
        }
        return state;
    }
}
