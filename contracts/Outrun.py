# { "Depends": "py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng" }

import json
import time
from dataclasses import dataclass
from typing import cast

import genlayer as gl
from genlayer import Address, u256
from genlayer.storage import TreeMap


CATEGORY_US_INDICES = 0
CATEGORY_ASIA_INDICES = 1
CATEGORY_SECTOR_INDICES = 2
CATEGORY_COUNT = 3

OUTCOME_COUNT = 3
OUTCOME_NONE = 3

SOURCE_BYBIT = "BYBIT"
SOURCE_GATE = "GATE"
SOURCE_BITGET = "BITGET"

STATE_OPEN = "OPEN"
STATE_PENDING = "SETTLEMENT_PENDING"
STATE_SETTLED = "SETTLED"
STATE_INCONCLUSIVE = "INCONCLUSIVE"

SOURCE_VALID = "VALID"
SOURCE_TIE = "TIE"
SOURCE_UNAVAILABLE = "UNAVAILABLE"

DURATION_SECONDS = 3600
SETTLEMENT_RETRY_WINDOW_SECONDS = 14400
GEN_SCALE = 1_000_000_000_000_000_000
MIN_BET = GEN_SCALE
MAX_BET_PER_MARKET = 20 * GEN_SCALE
PRICE_SCALE = GEN_SCALE
RETURN_SCALE = 1_000_000
MAX_RESPONSE_BYTES = 65_536
MAX_SOURCE_ATTEMPTS = 4
MAX_PAGE_SIZE = 50
MAX_MARKETS = 1024
MAX_POSITIONS = 100_000
MAX_ACTIVITIES = MAX_POSITIONS
U256_MAX = 2**256 - 1


@dataclass
class AssetEvidence:
    asset_id: u256
    asset: str
    symbol: str
    market_start: u256
    market_end: u256
    candle_timestamp: str
    timestamp_unit: str
    interval: str
    open: str
    close: str
    return_units: int
    valid: bool


@dataclass
class SourceEvidence:
    source: str
    category_id: u256
    category: str
    market_start: u256
    market_end: u256
    interval: str
    source_status: str
    source_winner: str
    source_winner_id: u256
    assets: list[AssetEvidence]


@dataclass
class MarketView:
    id: u256
    category_id: u256
    category: str
    assets: list[str]
    symbols: list[str]
    symbols_by_source: dict[str, list[str]]
    market_start: u256
    market_end: u256
    betting_close: u256
    duration_seconds: u256
    state: str
    winner_id: u256
    winner: str
    total_pool: u256
    outcome_pools: dict[str, u256]
    betting_open: bool
    settlement_available: bool
    settlement_deadline: u256
    winning_pool: u256
    claimed_pool: u256
    refunded_pool: u256
    remaining_pool: u256


@dataclass
class PositionView:
    market_id: u256
    has_position: bool
    category_id: u256
    category: str
    selected_asset_id: u256
    selected_asset: str
    total_stake: u256
    market_state: str
    can_top_up: bool
    position_won: bool
    position_lost: bool
    claim_available: bool
    refund_available: bool
    already_claimed: bool
    refunded: bool
    claimable_amount: u256
    claim_type: str


@dataclass
class ConfigView:
    protocol: str
    categories: list[str]
    category_ids: dict[str, u256]
    category_assets: dict[str, list[str]]
    duration_seconds: u256
    minimum_bet: u256
    maximum_bet_per_wallet_per_market: u256
    fee_bps: u256
    sources: list[str]
    consensus_threshold: u256
    timezone: str
    return_precision_units: u256
    price_precision: u256
    payout_rounding: str
    zero_backed_winner_behavior: str
    settlement_retry_window_seconds: u256
    max_page_size: u256
    max_markets: u256
    max_positions: u256
    max_activities: u256


@dataclass
class BettingStateView:
    category_id: u256
    category: str
    total_market_pool: u256
    outcome_stakes: dict[str, u256]
    bettor_asset_id: u256
    bettor_asset: str
    bettor_stake: u256
    claimed: bool
    refunded: bool
    winning_pool: u256
    claimed_pool: u256
    claimed_winning_stake: u256
    refunded_pool: u256


@dataclass
class ActivityView:
    id: u256
    wallet: str
    market_id: u256
    type: str
    category: str
    asset: str
    amount: str
    timestamp: int


@gl.evm.contract_interface
class _Recipient:
    class View:
        pass

    class Write:
        pass


def _is_u256(value) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= U256_MAX


def _category_id(category) -> u256:
    if (isinstance(category, int) and not isinstance(category, bool) and category == CATEGORY_US_INDICES) or category == "US_INDICES":
        return CATEGORY_US_INDICES
    if (isinstance(category, int) and not isinstance(category, bool) and category == CATEGORY_ASIA_INDICES) or category == "ASIA_INDICES":
        return CATEGORY_ASIA_INDICES
    if (isinstance(category, int) and not isinstance(category, bool) and category == CATEGORY_SECTOR_INDICES) or category == "SECTOR_INDICES":
        return CATEGORY_SECTOR_INDICES
    raise gl.vm.UserError("invalid category")


def _category_name(category) -> str:
    category_id = _category_id(category)
    if category_id == CATEGORY_US_INDICES:
        return "US_INDICES"
    if category_id == CATEGORY_ASIA_INDICES:
        return "ASIA_INDICES"
    return "SECTOR_INDICES"


def _asset_names(category) -> list[str]:
    category_id = _category_id(category)
    if category_id == CATEGORY_US_INDICES:
        return ["SPY", "QQQ", "IWM"]
    if category_id == CATEGORY_ASIA_INDICES:
        return ["EWJ", "EWY", "EWT"]
    return ["SMH", "XBI", "XLE"]


def _asset_id(category, asset) -> u256:
    category_id = _category_id(category)
    if _is_u256(asset) and asset < OUTCOME_COUNT:
        return asset
    names = _asset_names(category_id)
    if isinstance(asset, str) and asset in names:
        return names.index(asset)
    raise gl.vm.UserError("invalid market asset")


def _asset_name(category, asset) -> str:
    asset_id = _asset_id(category, asset)
    return _asset_names(category)[asset_id]


def _symbol(source: str, category: u256, asset: u256) -> str:
    if source != SOURCE_BYBIT and source != SOURCE_GATE and source != SOURCE_BITGET:
        raise gl.vm.UserError("invalid source")
    category_id = _category_id(category)
    asset_id = _asset_id(category_id, asset)
    names = _asset_names(category_id)
    name = names[asset_id]
    if source == SOURCE_GATE:
        return name + "_USDT"
    return name + "USDT"


def _sources() -> list[str]:
    return [SOURCE_BYBIT, SOURCE_GATE, SOURCE_BITGET]


def _now() -> int:
    return int(time.time())


def _parse_integer(value) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if 0 <= value <= U256_MAX else None
    if not isinstance(value, str) or len(value) > 40 or not value:
        return None
    for char in value:
        if char < "0" or char > "9":
            return None
    number = int(value)
    return number if number <= U256_MAX else None


def _parse_price(value):
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        text = str(value)
    elif isinstance(value, str):
        text = value
    else:
        return None
    if not text or len(text) > 60 or text.startswith("+") or text.startswith("-"):
        return None
    pieces = text.split(".")
    if len(pieces) > 2 or not pieces[0] or len(pieces[0]) > 38:
        return None
    for char in pieces[0]:
        if char < "0" or char > "9":
            return None
    fraction = pieces[1] if len(pieces) == 2 else ""
    if fraction and (len(fraction) > 18 or not all("0" <= char <= "9" for char in fraction)):
        return None
    scaled = int(pieces[0]) * PRICE_SCALE + int((fraction + "0" * 18)[:18])
    if scaled <= 0 or scaled > U256_MAX:
        return None
    canonical_fraction = fraction.rstrip("0")
    canonical = str(int(pieces[0]))
    if canonical_fraction:
        canonical += "." + canonical_fraction
    return scaled, canonical


def _add_u256(left: int, right: int) -> int:
    if left < 0 or right < 0 or left > U256_MAX or right > U256_MAX - left:
        raise gl.vm.UserError("u256 addition overflow")
    return left + right


def _mul_u256(left: int, right: int) -> int:
    if left < 0 or right < 0 or left > U256_MAX or right > U256_MAX:
        raise gl.vm.UserError("u256 multiplication overflow")
    if right and left > U256_MAX // right:
        raise gl.vm.UserError("u256 multiplication overflow")
    return left * right


def _mul_div_u256(numerator: int, multiplier: int, denominator: int) -> int:
    if numerator < 0 or multiplier < 0 or denominator <= 0 or numerator > denominator:
        raise gl.vm.UserError("invalid payout arithmetic")
    quotient = 0
    remainder = 0
    for bit_index in range(256):
        bit = (numerator >> (255 - bit_index)) & 1
        carry = remainder * 2 + (multiplier if bit else 0)
        added, remainder = divmod(carry, denominator)
        quotient = quotient * 2 + added
    if quotient > U256_MAX:
        raise gl.vm.UserError("u256 payout overflow")
    return quotient


def _return_units(open_scaled: int, close_scaled: int) -> int:
    numerator = (close_scaled - open_scaled) * 100 * RETURN_SCALE
    if numerator >= 0:
        return (numerator + open_scaled // 2) // open_scaled
    return -((-numerator + open_scaled // 2) // open_scaled)


def _compare_return(left_open: int, left_close: int, right_open: int, right_close: int) -> int:
    left_delta = left_close - left_open
    right_delta = right_close - right_open
    left_cross = left_delta * right_open
    right_cross = right_delta * left_open
    if left_cross > right_cross:
        return 1
    if left_cross < right_cross:
        return -1
    return 0


def _request_json(url: str):
    try:
        response = gl.nondet.web.get(url, headers={"Accept": "application/json"})
        if response.status != 200 or response.body is None or len(response.body) > MAX_RESPONSE_BYTES:
            return None
        return json.loads(response.body.decode("utf-8"))
    except (gl.nondet.NondetException, gl.vm.UserError, ValueError, TypeError, UnicodeError, AttributeError):
        return None


def _array_candle(payload, timestamp: int, source: str):
    if not isinstance(payload, list) or len(payload) != 1 or not isinstance(payload[0], list):
        return None
    row = payload[0]
    if len(row) != 7 or _parse_integer(row[0]) != timestamp:
        return None
    opening = _parse_price(row[1])
    high = _parse_price(row[2])
    low = _parse_price(row[3])
    closing = _parse_price(row[4])
    if opening is None or high is None or low is None or closing is None:
        return None
    return timestamp, opening, closing


def _bybit_candle(payload, timestamp: int, symbol: str):
    if not isinstance(payload, dict) or payload.get("retCode") != 0:
        return None
    result = payload.get("result")
    if not isinstance(result, dict) or result.get("category") != "linear" or result.get("symbol") != symbol:
        return None
    rows = result.get("list")
    if not isinstance(rows, list) or len(rows) > 3:
        return None
    for row in rows:
        if not isinstance(row, list) or len(row) != 7 or _parse_integer(row[0]) != timestamp:
            continue
        opening = _parse_price(row[1])
        high = _parse_price(row[2])
        low = _parse_price(row[3])
        closing = _parse_price(row[4])
        if opening is None or high is None or low is None or closing is None:
            return None
        return timestamp, opening, closing
    return None


def _gate_candle(payload, timestamp: int, symbol: str):
    if not isinstance(payload, list) or len(payload) != 1:
        return None
    row = payload[0]
    if isinstance(row, list):
        if len(row) != 7 or _parse_integer(row[0]) != timestamp:
            return None
        opening = _parse_price(row[5])
        high = _parse_price(row[3])
        low = _parse_price(row[4])
        closing = _parse_price(row[2])
    elif isinstance(row, dict):
        if len(row) > 10 or not all(key in row for key in ("t", "o", "h", "l", "c")):
            return None
        if row.get("source", SOURCE_GATE) != SOURCE_GATE or row.get("symbol", symbol) != symbol:
            return None
        if row.get("asset", symbol[:-5]) != symbol[:-5] or row.get("contract", symbol) != symbol or row.get("interval", "1h") != "1h":
            return None
        if _parse_integer(row["t"]) != timestamp:
            return None
        opening = _parse_price(row["o"])
        high = _parse_price(row["h"])
        low = _parse_price(row["l"])
        closing = _parse_price(row["c"])
    else:
        return None
    if opening is None or high is None or low is None or closing is None:
        return None
    return timestamp, opening, closing


def _fetch_candle(source: str, category: u256, asset: u256, start_seconds: u256, end_seconds: u256):
    symbol = _symbol(source, category, asset)
    start_ms = _mul_u256(start_seconds, 1000)
    end_ms = _mul_u256(end_seconds, 1000)
    if source == SOURCE_BYBIT:
        url = "https://api.bybit.com/v5/market/kline?category=linear&symbol=" + symbol + "&interval=60&start=" + str(start_ms) + "&end=" + str(end_ms) + "&limit=3"
        return _bybit_candle(_request_json(url), start_ms, symbol)
    if source == SOURCE_GATE:
        url = "https://api.gateio.ws/api/v4/futures/usdt/candlesticks?contract=" + symbol + "&interval=1h&from=" + str(start_seconds) + "&to=" + str(end_seconds - 1)
        return _gate_candle(_request_json(url), start_seconds, symbol)
    url = "https://api.bitget.com/api/v3/market/candles?category=USDT-FUTURES&symbol=" + symbol + "&interval=1H&type=market&startTime=" + str(start_ms) + "&endTime=" + str(end_ms - 1) + "&limit=1"
    payload = _request_json(url)
    if not isinstance(payload, dict) or payload.get("code") != "00000" or "data" not in payload:
        return None
    if payload.get("source", SOURCE_BITGET) != SOURCE_BITGET or payload.get("category", "USDT-FUTURES") != "USDT-FUTURES":
        return None
    if payload.get("asset", symbol[:-4]) != symbol[:-4] or payload.get("symbol", symbol) != symbol or payload.get("interval", "1H") != "1H" or payload.get("type", "market") != "market":
        return None
    return _array_candle(payload["data"], start_ms, SOURCE_BITGET)


def _empty_asset(source: str, category: u256, asset: u256, start: u256, end: u256) -> dict:
    return {
        "asset_id": asset,
        "asset": _asset_name(category, asset),
        "symbol": _symbol(source, category, asset),
        "market_start": start,
        "market_end": end,
        "candle_timestamp": "",
        "timestamp_unit": "",
        "interval": "1h",
        "open": "",
        "close": "",
        "return_units": 0,
        "valid": False,
    }


def _unavailable_result(source: str, category: u256, start: u256, end: u256) -> dict:
    return {
        "source": source,
        "category_id": category,
        "category": _category_name(category),
        "market_start": start,
        "market_end": end,
        "interval": "1h",
        "source_status": SOURCE_UNAVAILABLE,
        "source_winner": "",
        "source_winner_id": OUTCOME_NONE,
        "assets": [_empty_asset(source, category, asset, start, end) for asset in range(OUTCOME_COUNT)],
    }


def _source_result(source: str, category: u256, start: u256, end: u256) -> dict:
    rows = []
    for asset in range(OUTCOME_COUNT):
        candle = _fetch_candle(source, category, asset, start, end)
        if candle is None:
            return _unavailable_result(source, category, start, end)
        timestamp, opening, closing = candle
        opening_scaled, opening_text = opening
        closing_scaled, closing_text = closing
        rows.append({
            "asset_id": asset,
            "asset": _asset_name(category, asset),
            "symbol": _symbol(source, category, asset),
            "market_start": start,
            "market_end": end,
            "candle_timestamp": str(timestamp),
            "timestamp_unit": "s" if source == SOURCE_GATE else "ms",
            "interval": "1h",
            "open": opening_text,
            "close": closing_text,
            "return_units": _return_units(opening_scaled, closing_scaled),
            "valid": True,
            "_open_scaled": opening_scaled,
            "_close_scaled": closing_scaled,
        })
    winner = 0
    tied = False
    for asset in range(1, OUTCOME_COUNT):
        comparison = _compare_return(rows[asset]["_open_scaled"], rows[asset]["_close_scaled"], rows[winner]["_open_scaled"], rows[winner]["_close_scaled"])
        if comparison > 0:
            winner = asset
            tied = False
        elif comparison == 0:
            tied = True
    for row in rows:
        del row["_open_scaled"]
        del row["_close_scaled"]
    return {
        "source": source,
        "category_id": category,
        "category": _category_name(category),
        "market_start": start,
        "market_end": end,
        "interval": "1h",
        "source_status": SOURCE_TIE if tied else SOURCE_VALID,
        "source_winner": "" if tied else _asset_name(category, winner),
        "source_winner_id": OUTCOME_NONE if tied else winner,
        "assets": rows,
    }


PROPOSAL_WINNER = "WINNER"
PROPOSAL_RETRYABLE = "RETRYABLE"
PROPOSAL_DEFINITIVE = "DEFINITIVE_NO_CONSENSUS"


def _evidence_key(evidence: dict, source: str, category: u256, start: u256, end: u256) -> str | None:
    if not isinstance(evidence, dict) or evidence.get("source") != source:
        return None
    if evidence.get("category_id") != category or evidence.get("category") != _category_name(category):
        return None
    if evidence.get("market_start") != start or evidence.get("market_end") != end or evidence.get("interval") != "1h":
        return None
    status = evidence.get("source_status")
    winner = evidence.get("source_winner")
    winner_id = evidence.get("source_winner_id")
    if status not in (SOURCE_VALID, SOURCE_TIE, SOURCE_UNAVAILABLE) or not isinstance(winner, str) or not isinstance(winner_id, int) or isinstance(winner_id, bool) or winner_id < 0 or winner_id > OUTCOME_NONE:
        return None
    if status == SOURCE_VALID and (winner_id >= OUTCOME_COUNT or winner != _asset_name(category, winner_id)):
        return None
    if status != SOURCE_VALID and (winner != "" or winner_id != OUTCOME_NONE):
        return None
    rows = evidence.get("assets")
    if not isinstance(rows, list) or len(rows) != OUTCOME_COUNT:
        return None
    parts = [source, str(category), _category_name(category), str(start), str(end), "1h", status, winner, str(winner_id)]
    for asset in range(OUTCOME_COUNT):
        row = rows[asset]
        if not isinstance(row, dict) or row.get("asset_id") != asset or row.get("asset") != _asset_name(category, asset) or row.get("symbol") != _symbol(source, category, asset):
            return None
        if row.get("market_start") != start or row.get("market_end") != end or row.get("interval") != "1h":
            return None
        if not isinstance(row.get("candle_timestamp"), str) or not isinstance(row.get("timestamp_unit"), str) or not isinstance(row.get("open"), str) or not isinstance(row.get("close"), str):
            return None
        if not isinstance(row.get("return_units"), int) or isinstance(row.get("return_units"), bool) or not isinstance(row.get("valid"), bool):
            return None
        valid = status != SOURCE_UNAVAILABLE
        if row["valid"] != valid:
            return None
        if valid:
            expected_timestamp = str(start if source == SOURCE_GATE else _mul_u256(start, 1000))
            expected_unit = "s" if source == SOURCE_GATE else "ms"
            if row["candle_timestamp"] != expected_timestamp or row["timestamp_unit"] != expected_unit:
                return None
            opening = _parse_price(row["open"])
            closing = _parse_price(row["close"])
            if opening is None or closing is None or row["return_units"] != _return_units(opening[0], closing[0]):
                return None
        elif row["candle_timestamp"] != "" or row["timestamp_unit"] != "" or row["open"] != "" or row["close"] != "":
            return None
        parts.extend([str(row["asset_id"]), row["asset"], row["symbol"], row["candle_timestamp"], row["timestamp_unit"], row["open"], row["close"], str(row["return_units"]), str(row["valid"])])
    return "\x1f".join(parts)


def _source_result_with_retries(source: str, category: u256, start: u256, end: u256) -> dict:
    result = _unavailable_result(source, category, start, end)
    for _ in range(MAX_SOURCE_ATTEMPTS):
        result = _source_result(source, category, start, end)
        if result.get("source_status") != SOURCE_UNAVAILABLE:
            return result
    return result


def _consensus_winner(results: list[dict]) -> int:
    votes = []
    for result in results:
        votes.append(result.get("source_winner_id", OUTCOME_NONE) if result.get("source_status") == SOURCE_VALID else OUTCOME_NONE)
    if votes[0] != OUTCOME_NONE and votes[0] == votes[1]:
        return votes[0]
    if votes[0] != OUTCOME_NONE and votes[0] == votes[2]:
        return votes[0]
    if votes[1] != OUTCOME_NONE and votes[1] == votes[2]:
        return votes[1]
    return OUTCOME_NONE


def _settlement_proposal(category: u256, start: u256, end: u256) -> dict:
    results = [_source_result_with_retries(source, category, start, end) for source in _sources()]
    winner = _consensus_winner(results)
    if winner != OUTCOME_NONE:
        classification = PROPOSAL_WINNER
    else:
        unavailable = any(result.get("source_status") == SOURCE_UNAVAILABLE for result in results)
        classification = PROPOSAL_RETRYABLE if unavailable else PROPOSAL_DEFINITIVE
    return {"results": results, "winner": winner, "classification": classification}


def _proposal_valid(proposal: dict, category: u256, start: u256, end: u256) -> bool:
    if not isinstance(proposal, dict):
        return False
    results = proposal.get("results")
    if not isinstance(results, list) or len(results) != len(_sources()):
        return False
    for index, source in enumerate(_sources()):
        if _evidence_key(results[index], source, category, start, end) is None:
            return False
    winner = proposal.get("winner")
    if not isinstance(winner, int) or isinstance(winner, bool) or winner < 0 or winner > OUTCOME_NONE or winner != _consensus_winner(results):
        return False
    classification = proposal.get("classification")
    if winner != OUTCOME_NONE:
        return classification == PROPOSAL_WINNER
    unavailable = any(result.get("source_status") == SOURCE_UNAVAILABLE for result in results)
    expected = PROPOSAL_RETRYABLE if unavailable else PROPOSAL_DEFINITIVE
    return classification == expected


def _proposal_equivalent(leader: dict, validator: dict, category: u256, start: u256, end: u256) -> bool:
    if not _proposal_valid(leader, category, start, end) or not _proposal_valid(validator, category, start, end):
        return False
    winner = leader.get("winner")
    if not isinstance(winner, int) or isinstance(winner, bool):
        return False
    if winner != validator["winner"]:
        return False
    if winner == OUTCOME_NONE:
        return leader["classification"] == validator["classification"]
    common = 0
    for index, source in enumerate(_sources()):
        leader_result = leader["results"][index]
        validator_result = validator["results"][index]
        if leader_result.get("source_status") == SOURCE_VALID and validator_result.get("source_status") == SOURCE_VALID and leader_result.get("source_winner_id") == winner and validator_result.get("source_winner_id") == winner and _evidence_key(leader_result, source, category, start, end) == _evidence_key(validator_result, source, category, start, end):
            common += 1
    return common >= 2


class Outrun(gl.contract.Contract):
    market_count: u256
    position_count: u256
    market_category: TreeMap[u256, u256]
    market_start_seconds: TreeMap[u256, u256]
    market_end_seconds: TreeMap[u256, u256]
    market_state: TreeMap[u256, str]
    market_winner: TreeMap[u256, u256]
    market_creation_keys: TreeMap[str, u256]
    market_source_evidence: TreeMap[str, str]
    market_pool: TreeMap[u256, u256]
    market_winning_pool: TreeMap[u256, u256]
    market_claimed_pool: TreeMap[u256, u256]
    market_claimed_winning_stake: TreeMap[u256, u256]
    market_refunded_pool: TreeMap[u256, u256]
    market_settlement_deadline: TreeMap[u256, u256]
    outcome_pool: TreeMap[str, u256]
    bettor_outcome: TreeMap[str, u256]
    bettor_stake: TreeMap[str, u256]
    bettor_claimed: TreeMap[str, bool]
    bettor_refunded: TreeMap[str, bool]
    user_market_count: TreeMap[str, u256]
    user_market_index: TreeMap[str, u256]
    user_activity_count: TreeMap[str, u256]
    user_activity: TreeMap[str, str]
    activity_total_count: u256

    def __init__(self):
        self.market_count = 0
        self.position_count = 0
        self.activity_total_count = 0

    def _require_market(self, market_id: u256) -> None:
        if not _is_u256(market_id) or market_id == 0 or market_id > self.market_count or market_id not in self.market_category:
            raise gl.vm.UserError("market not found")

    def _source_key(self, market_id: u256, source: str) -> str:
        return str(market_id) + ":" + source

    def _outcome_key(self, market_id: u256, outcome: u256) -> str:
        return str(market_id) + ":" + str(outcome)

    def _position_key(self, market_id: u256, user: Address) -> str:
        return str(market_id) + ":" + user.as_hex

    def _user_market_key(self, user: Address, index: u256) -> str:
        return user.as_hex + ":" + str(index)

    def _user_activity_key(self, user: Address, index: u256) -> str:
        return user.as_hex + ":" + str(index)

    def _record_activity(self, user: Address, market_id: u256, activity_type: str, category: u256, asset: u256, amount: u256) -> None:
        if self.activity_total_count >= MAX_ACTIVITIES:
            return
        user_key = user.as_hex
        user_count = self.user_activity_count.get(user_key, 0)
        if user_count >= MAX_ACTIVITIES:
            return
        activity = {
            "id": user_count,
            "wallet": user_key,
            "market_id": market_id,
            "type": activity_type,
            "category": _category_name(category),
            "asset": _asset_name(category, asset),
            "amount": str(amount),
            "timestamp": _now(),
        }
        self.user_activity[self._user_activity_key(user, user_count)] = json.dumps(activity, separators=(",", ":"), sort_keys=True)
        self.user_activity_count[user_key] = _add_u256(user_count, 1)
        self.activity_total_count = _add_u256(self.activity_total_count, 1)

    def _send_value(self, recipient: Address, amount: u256) -> None:
        _Recipient(recipient).emit_transfer(value=amount)

    def _market_preview(self, market_id: u256) -> dict:
        category = self.market_category[market_id]
        state = self.market_state[market_id]
        total_pool = self.market_pool.get(market_id, 0)
        claimed_pool = self.market_claimed_pool.get(market_id, 0)
        refunded_pool = self.market_refunded_pool.get(market_id, 0)
        if claimed_pool > total_pool or refunded_pool > total_pool:
            raise gl.vm.UserError("market liability overflow")
        consumed = claimed_pool if state == STATE_SETTLED else refunded_pool if state == STATE_INCONCLUSIVE else 0
        if consumed > total_pool:
            raise gl.vm.UserError("market liability overflow")
        winner = self.market_winner[market_id]
        now_seconds = _now()
        return {
            "id": market_id,
            "category_id": category,
            "category": _category_name(category),
            "assets": _asset_names(category),
            "symbols": [_symbol(SOURCE_BYBIT, category, i) for i in range(OUTCOME_COUNT)],
            "symbols_by_source": {source: [_symbol(source, category, i) for i in range(OUTCOME_COUNT)] for source in _sources()},
            "market_start": self.market_start_seconds[market_id],
            "market_end": self.market_end_seconds[market_id],
            "betting_close": self.market_start_seconds[market_id],
            "duration_seconds": DURATION_SECONDS,
            "state": state,
            "winner_id": winner,
            "winner": "" if winner == OUTCOME_NONE else _asset_name(category, winner),
            "total_pool": total_pool,
            "outcome_pools": {_asset_name(category, i): self.outcome_pool.get(self._outcome_key(market_id, i), 0) for i in range(OUTCOME_COUNT)},
            "betting_open": state == STATE_OPEN and now_seconds < self.market_start_seconds[market_id],
            "settlement_available": state in (STATE_OPEN, STATE_PENDING) and now_seconds >= self.market_end_seconds[market_id],
            "settlement_deadline": self.market_settlement_deadline[market_id],
            "winning_pool": self.market_winning_pool.get(market_id, 0),
            "claimed_pool": claimed_pool,
            "refunded_pool": refunded_pool,
            "remaining_pool": total_pool - consumed,
        }

    def _position_view(self, market_id: u256, user: Address) -> dict:
        self._require_market(market_id)
        category = self.market_category[market_id]
        key = self._position_key(market_id, user)
        selected = self.bettor_outcome.get(key, OUTCOME_NONE)
        has_position = selected != OUTCOME_NONE
        stake = self.bettor_stake.get(key, 0)
        state = self.market_state[market_id]
        claimed = self.bettor_claimed.get(key, False)
        refunded = self.bettor_refunded.get(key, False)
        winner = self.market_winner[market_id]
        now_seconds = _now()
        position_won = state == STATE_SETTLED and has_position and selected == winner
        position_lost = state == STATE_SETTLED and has_position and selected != winner
        claimable = 0
        claim_available = False
        if position_won and not claimed:
            winning_pool = self.market_winning_pool.get(market_id, 0)
            claimed_stake = self.market_claimed_winning_stake.get(market_id, 0)
            claimed_pool = self.market_claimed_pool.get(market_id, 0)
            total_pool = self.market_pool.get(market_id, 0)
            new_stake = _add_u256(claimed_stake, stake)
            if winning_pool > 0 and claimed_stake <= winning_pool and claimed_pool <= total_pool and new_stake <= winning_pool:
                claimable = total_pool - claimed_pool if new_stake == winning_pool else _mul_div_u256(stake, total_pool, winning_pool)
                claim_available = claimable > 0
        refund_available = state == STATE_INCONCLUSIVE and has_position and stake > 0 and not refunded
        if refund_available:
            claimable = stake
        return {
            "market_id": market_id,
            "has_position": has_position,
            "category_id": category,
            "category": _category_name(category),
            "selected_asset_id": selected,
            "selected_asset": "" if not has_position else _asset_name(category, selected),
            "total_stake": stake,
            "market_state": state,
            "can_top_up": state == STATE_OPEN and now_seconds < self.market_start_seconds[market_id] and has_position,
            "position_won": position_won,
            "position_lost": position_lost,
            "claim_available": claim_available,
            "refund_available": refund_available,
            "already_claimed": claimed,
            "refunded": refunded,
            "claimable_amount": claimable,
            "claim_type": "REFUND" if refund_available else "WINNINGS" if claim_available else "NONE",
        }

    def _page_bounds(self, offset: u256, limit: u256, count: u256) -> tuple[int, int]:
        if not _is_u256(offset) or not _is_u256(limit) or limit > MAX_PAGE_SIZE:
            raise gl.vm.UserError("page limit exceeded")
        if offset >= count or limit == 0:
            return 0, 0
        return offset, min(count, _add_u256(offset, limit))

    @gl.public.view
    def categories(self) -> list[str]:
        return ["US_INDICES", "ASIA_INDICES", "SECTOR_INDICES"]

    @gl.public.view
    def category_assets(self, category: str) -> list[str]:
        if not isinstance(category, str):
            raise gl.vm.UserError("category must be a string")
        return _asset_names(category)

    @gl.public.view
    def get_config(self) -> ConfigView:
        return cast(ConfigView, {
            "protocol": "OUTRUN V1",
            "categories": ["US_INDICES", "ASIA_INDICES", "SECTOR_INDICES"],
            "category_ids": {"US_INDICES": CATEGORY_US_INDICES, "ASIA_INDICES": CATEGORY_ASIA_INDICES, "SECTOR_INDICES": CATEGORY_SECTOR_INDICES},
            "category_assets": {"US_INDICES": _asset_names(CATEGORY_US_INDICES), "ASIA_INDICES": _asset_names(CATEGORY_ASIA_INDICES), "SECTOR_INDICES": _asset_names(CATEGORY_SECTOR_INDICES)},
            "duration_seconds": DURATION_SECONDS,
            "minimum_bet": MIN_BET,
            "maximum_bet_per_wallet_per_market": MAX_BET_PER_MARKET,
            "fee_bps": 0,
            "sources": _sources(),
            "consensus_threshold": 2,
            "timezone": "UTC",
            "return_precision_units": RETURN_SCALE,
            "price_precision": PRICE_SCALE,
            "payout_rounding": "floor; final winning claimant receives remaining pool",
            "zero_backed_winner_behavior": "inconclusive with original-stake refunds",
            "settlement_retry_window_seconds": SETTLEMENT_RETRY_WINDOW_SECONDS,
            "max_page_size": MAX_PAGE_SIZE,
            "max_markets": MAX_MARKETS,
            "max_positions": MAX_POSITIONS,
            "max_activities": MAX_ACTIVITIES,
        })

    @gl.public.view
    def get_market(self, market_id: u256) -> MarketView:
        self._require_market(market_id)
        return cast(MarketView, self._market_preview(market_id))

    @gl.public.view
    def get_markets(self, offset: u256, limit: u256) -> list[MarketView]:
        start, end = self._page_bounds(offset, limit, self.market_count)
        return cast(list[MarketView], [self._market_preview(self.market_count - index) for index in range(start, end)])

    @gl.public.view
    def get_open_markets(self, offset: u256, limit: u256) -> list[MarketView]:
        if not _is_u256(offset) or not _is_u256(limit) or limit > MAX_PAGE_SIZE:
            raise gl.vm.UserError("page limit exceeded")
        if limit == 0:
            return []
        results = []
        matched = 0
        for reverse_index in range(self.market_count):
            market = self._market_preview(self.market_count - reverse_index)
            if market["betting_open"]:
                if matched >= offset:
                    results.append(market)
                    if len(results) >= limit:
                        break
                matched = _add_u256(matched, 1)
        return cast(list[MarketView], results)

    @gl.public.view
    def get_market_count(self) -> u256:
        return self.market_count

    @gl.public.view
    def get_my_position(self, market_id: u256) -> PositionView:
        return cast(PositionView, self._position_view(market_id, gl.message.sender_address))

    @gl.public.view
    def get_my_market_count(self) -> u256:
        return self.user_market_count.get(gl.message.sender_address.as_hex, 0)

    @gl.public.view
    def get_my_positions(self, offset: u256, limit: u256) -> list[PositionView]:
        user = gl.message.sender_address
        count = self.user_market_count.get(user.as_hex, 0)
        start, end = self._page_bounds(offset, limit, count)
        return cast(list[PositionView], [self._position_view(self.user_market_index[self._user_market_key(user, count - index - 1)], user) for index in range(start, end)])

    @gl.public.view
    def get_my_claimable_markets(self, offset: u256, limit: u256) -> list[PositionView]:
        user = gl.message.sender_address
        if not _is_u256(offset) or not _is_u256(limit) or limit > MAX_PAGE_SIZE:
            raise gl.vm.UserError("page limit exceeded")
        if limit == 0:
            return []
        count = self.user_market_count.get(user.as_hex, 0)
        results = []
        matched = 0
        for reverse_index in range(count):
            market_id = self.user_market_index[self._user_market_key(user, count - reverse_index - 1)]
            position = self._position_view(market_id, user)
            if position["claim_available"] or position["refund_available"]:
                if matched >= offset:
                    results.append(position)
                    if len(results) >= limit:
                        break
                matched = _add_u256(matched, 1)
        return cast(list[PositionView], results)

    @gl.public.view
    def get_market_by_category_start(self, category: str, market_start: u256) -> MarketView:
        if not isinstance(category, str):
            raise gl.vm.UserError("category must be a string")
        category_id = _category_id(category)
        if not _is_u256(market_start) or market_start % DURATION_SECONDS != 0:
            raise gl.vm.UserError("market start must be exact UTC hour")
        key = str(category_id) + "\x1f" + str(market_start)
        if key not in self.market_creation_keys:
            raise gl.vm.UserError("market not found")
        return cast(MarketView, self._market_preview(self.market_creation_keys[key]))

    @gl.public.view
    def get_source_evidence(self, market_id: u256, source: str) -> SourceEvidence:
        self._require_market(market_id)
        if source not in _sources():
            raise gl.vm.UserError("invalid source")
        key = self._source_key(market_id, source)
        if key not in self.market_source_evidence:
            raise gl.vm.UserError("source evidence unavailable")
        return cast(SourceEvidence, json.loads(self.market_source_evidence[key]))

    @gl.public.view
    def get_betting_state(self, market_id: u256) -> BettingStateView:
        self._require_market(market_id)
        category = self.market_category[market_id]
        key = self._position_key(market_id, gl.message.sender_address)
        selected = self.bettor_outcome.get(key, OUTCOME_NONE)
        return cast(BettingStateView, {
            "category_id": category,
            "category": _category_name(category),
            "total_market_pool": self.market_pool.get(market_id, 0),
            "outcome_stakes": {_asset_name(category, i): self.outcome_pool.get(self._outcome_key(market_id, i), 0) for i in range(OUTCOME_COUNT)},
            "bettor_asset_id": selected,
            "bettor_asset": "" if selected == OUTCOME_NONE else _asset_name(category, selected),
            "bettor_stake": self.bettor_stake.get(key, 0),
            "claimed": self.bettor_claimed.get(key, False),
            "refunded": self.bettor_refunded.get(key, False),
            "winning_pool": self.market_winning_pool.get(market_id, 0),
            "claimed_pool": self.market_claimed_pool.get(market_id, 0),
            "claimed_winning_stake": self.market_claimed_winning_stake.get(market_id, 0),
            "refunded_pool": self.market_refunded_pool.get(market_id, 0),
        })

    @gl.public.view
    def get_my_activity_count(self) -> u256:
        return self.user_activity_count.get(gl.message.sender_address.as_hex, 0)

    @gl.public.view
    def get_my_activity(self, offset: u256, limit: u256) -> list[ActivityView]:
        user = gl.message.sender_address
        count = self.user_activity_count.get(user.as_hex, 0)
        start, end = self._page_bounds(offset, limit, count)
        return cast(list[ActivityView], [json.loads(self.user_activity[self._user_activity_key(user, count - index - 1)]) for index in range(start, end)])

    @gl.public.write
    def create_market(self, category: str, market_start: u256) -> u256:
        if not isinstance(category, str) or not _is_u256(market_start):
            raise gl.vm.UserError("invalid market input")
        if market_start % DURATION_SECONDS != 0:
            raise gl.vm.UserError("market start must be exact UTC hour")
        category_id = _category_id(category)
        if market_start <= _now():
            raise gl.vm.UserError("market start must be in future")
        if self.market_count >= MAX_MARKETS:
            raise gl.vm.UserError("maximum market count reached")
        market_key = str(category_id) + "\x1f" + str(market_start)
        if market_key in self.market_creation_keys:
            raise gl.vm.UserError("market already exists")
        market_id = _add_u256(self.market_count, 1)
        end_seconds = _add_u256(market_start, DURATION_SECONDS)
        deadline = _add_u256(end_seconds, SETTLEMENT_RETRY_WINDOW_SECONDS)
        _mul_u256(end_seconds, 1000)
        self.market_count = market_id
        self.market_category[market_id] = category_id
        self.market_start_seconds[market_id] = market_start
        self.market_end_seconds[market_id] = end_seconds
        self.market_state[market_id] = STATE_OPEN
        self.market_winner[market_id] = OUTCOME_NONE
        self.market_pool[market_id] = 0
        self.market_winning_pool[market_id] = 0
        self.market_claimed_pool[market_id] = 0
        self.market_claimed_winning_stake[market_id] = 0
        self.market_refunded_pool[market_id] = 0
        self.market_settlement_deadline[market_id] = deadline
        self.market_creation_keys[market_key] = market_id
        return market_id

    @gl.public.write.payable
    def place_bet(self, market_id: u256, asset: str) -> None:
        self._require_market(market_id)
        if self.market_state[market_id] != STATE_OPEN:
            raise gl.vm.UserError("market is not open")
        now_seconds = _now()
        if now_seconds >= self.market_start_seconds[market_id]:
            raise gl.vm.UserError("betting is closed")
        if not isinstance(asset, str):
            raise gl.vm.UserError("asset must be a string")
        outcome = _asset_id(self.market_category[market_id], asset)
        amount = gl.message.value
        if not _is_u256(amount) or amount < MIN_BET:
            raise gl.vm.UserError("minimum bet is 1 GEN")
        key = self._position_key(market_id, gl.message.sender_address)
        selected = self.bettor_outcome.get(key, OUTCOME_NONE)
        if selected != OUTCOME_NONE and selected != outcome:
            raise gl.vm.UserError("wallet outcome already selected")
        old_stake = self.bettor_stake.get(key, 0)
        if old_stake > MAX_BET_PER_MARKET or amount > MAX_BET_PER_MARKET - old_stake:
            raise gl.vm.UserError("maximum cumulative stake is 20 GEN")
        new_stake = _add_u256(old_stake, amount)
        outcome_key = self._outcome_key(market_id, outcome)
        new_outcome_pool = _add_u256(self.outcome_pool.get(outcome_key, 0), amount)
        new_market_pool = _add_u256(self.market_pool.get(market_id, 0), amount)
        first_position = selected == OUTCOME_NONE
        if first_position:
            if self.position_count >= MAX_POSITIONS:
                raise gl.vm.UserError("maximum position count reached")
            user_key = gl.message.sender_address.as_hex
            user_count = self.user_market_count.get(user_key, 0)
            if user_count >= MAX_POSITIONS:
                raise gl.vm.UserError("maximum user market count reached")
        self.bettor_outcome[key] = outcome
        self.bettor_stake[key] = new_stake
        self.outcome_pool[outcome_key] = new_outcome_pool
        self.market_pool[market_id] = new_market_pool
        if first_position:
            self.position_count = _add_u256(self.position_count, 1)
            user_key = gl.message.sender_address.as_hex
            user_count = self.user_market_count.get(user_key, 0)
            self.user_market_index[self._user_market_key(gl.message.sender_address, user_count)] = market_id
            self.user_market_count[user_key] = _add_u256(user_count, 1)
        self._record_activity(gl.message.sender_address, market_id, "BET_PLACED" if first_position else "BET_TOPPED_UP", self.market_category[market_id], outcome, amount)

    @gl.public.write
    def claim(self, market_id: u256) -> None:
        self._require_market(market_id)
        if self.market_state[market_id] != STATE_SETTLED:
            raise gl.vm.UserError("market is not settled")
        key = self._position_key(market_id, gl.message.sender_address)
        if self.bettor_claimed.get(key, False):
            raise gl.vm.UserError("payout already claimed")
        if self.bettor_refunded.get(key, False):
            raise gl.vm.UserError("position already refunded")
        outcome = self.bettor_outcome.get(key, OUTCOME_NONE)
        if outcome != self.market_winner[market_id]:
            raise gl.vm.UserError("not a winning bettor")
        stake = self.bettor_stake.get(key, 0)
        if stake <= 0:
            raise gl.vm.UserError("no bettor stake")
        winning_pool = self.market_winning_pool.get(market_id, 0)
        if winning_pool <= 0:
            raise gl.vm.UserError("winning pool is empty")
        total_pool = self.market_pool.get(market_id, 0)
        claimed_pool = self.market_claimed_pool.get(market_id, 0)
        claimed_stake = self.market_claimed_winning_stake.get(market_id, 0)
        if claimed_pool > total_pool or claimed_stake > winning_pool:
            raise gl.vm.UserError("claimed accounting exceeds pool")
        new_claimed_stake = _add_u256(claimed_stake, stake)
        if new_claimed_stake > winning_pool:
            raise gl.vm.UserError("winning stake accounting exceeds pool")
        payout = total_pool - claimed_pool if new_claimed_stake == winning_pool else _mul_div_u256(stake, total_pool, winning_pool)
        if payout <= 0 or payout > total_pool - claimed_pool:
            raise gl.vm.UserError("payout exceeds remaining pool")
        self.bettor_claimed[key] = True
        self.market_claimed_pool[market_id] = _add_u256(claimed_pool, payout)
        self.market_claimed_winning_stake[market_id] = new_claimed_stake
        self._send_value(gl.message.sender_address, payout)
        self._record_activity(gl.message.sender_address, market_id, "PAYOUT_CLAIMED", self.market_category[market_id], outcome, payout)

    @gl.public.write
    def claim_refund(self, market_id: u256) -> None:
        self._require_market(market_id)
        if self.market_state[market_id] != STATE_INCONCLUSIVE:
            raise gl.vm.UserError("market is not inconclusive")
        key = self._position_key(market_id, gl.message.sender_address)
        if self.bettor_refunded.get(key, False):
            raise gl.vm.UserError("refund already claimed")
        if self.bettor_claimed.get(key, False):
            raise gl.vm.UserError("position already claimed")
        stake = self.bettor_stake.get(key, 0)
        if stake <= 0:
            raise gl.vm.UserError("no bettor stake")
        total_pool = self.market_pool.get(market_id, 0)
        refunded_pool = self.market_refunded_pool.get(market_id, 0)
        if refunded_pool > total_pool or stake > total_pool - refunded_pool:
            raise gl.vm.UserError("refund exceeds remaining pool")
        outcome = self.bettor_outcome.get(key, OUTCOME_NONE)
        self.bettor_refunded[key] = True
        self.market_refunded_pool[market_id] = _add_u256(refunded_pool, stake)
        self._send_value(gl.message.sender_address, stake)
        self._record_activity(gl.message.sender_address, market_id, "REFUND_CLAIMED", self.market_category[market_id], outcome, stake)

    @gl.public.write
    def settle_market(self, market_id: u256) -> str:
        self._require_market(market_id)
        state = self.market_state[market_id]
        if state not in (STATE_OPEN, STATE_PENDING):
            raise gl.vm.UserError("market is not open")
        now_seconds = _now()
        end_seconds = self.market_end_seconds[market_id]
        deadline = self.market_settlement_deadline[market_id]
        if now_seconds < end_seconds:
            raise gl.vm.UserError("market has not expired")
        if now_seconds >= deadline:
            self.market_state[market_id] = STATE_INCONCLUSIVE
            self.market_winner[market_id] = OUTCOME_NONE
            self.market_winning_pool[market_id] = 0
            return STATE_INCONCLUSIVE
        if state == STATE_OPEN:
            for source in _sources():
                if self._source_key(market_id, source) in self.market_source_evidence:
                    raise gl.vm.UserError("duplicate source evidence")
        category = self.market_category[market_id]
        start_seconds = self.market_start_seconds[market_id]
        def leader_fn():
            return _settlement_proposal(category, start_seconds, end_seconds)

        def validator_fn(leaders_result) -> bool:
            if not isinstance(leaders_result, gl.vm.Return):
                return False
            try:
                validator_proposal = _settlement_proposal(category, start_seconds, end_seconds)
                return _proposal_equivalent(leaders_result.calldata, validator_proposal, category, start_seconds, end_seconds)
            except Exception:
                return False

        try:
            proposal = gl.vm.run_nondet(leader_fn, validator_fn)
        except Exception:
            self.market_state[market_id] = STATE_PENDING
            self.market_winner[market_id] = OUTCOME_NONE
            self.market_winning_pool[market_id] = 0
            return STATE_PENDING
        if not _proposal_valid(proposal, category, start_seconds, end_seconds):
            self.market_state[market_id] = STATE_PENDING
            self.market_winner[market_id] = OUTCOME_NONE
            self.market_winning_pool[market_id] = 0
            return STATE_PENDING
        results = proposal["results"]
        for index, source in enumerate(_sources()):
            self.market_source_evidence[self._source_key(market_id, source)] = json.dumps(results[index], separators=(",", ":"), sort_keys=True)
        winner = proposal["winner"]
        if winner == OUTCOME_NONE:
            self.market_winner[market_id] = OUTCOME_NONE
            self.market_winning_pool[market_id] = 0
            if proposal["classification"] == PROPOSAL_RETRYABLE:
                self.market_state[market_id] = STATE_PENDING
                return STATE_PENDING
            self.market_state[market_id] = STATE_INCONCLUSIVE
            return STATE_INCONCLUSIVE
        self.market_winner[market_id] = winner
        total_pool = self.market_pool.get(market_id, 0)
        winning_pool = self.outcome_pool.get(self._outcome_key(market_id, winner), 0)
        if total_pool > 0 and winning_pool == 0:
            self.market_state[market_id] = STATE_INCONCLUSIVE
            self.market_winner[market_id] = OUTCOME_NONE
            self.market_winning_pool[market_id] = 0
            return STATE_INCONCLUSIVE
        self.market_winning_pool[market_id] = winning_pool
        self.market_state[market_id] = STATE_SETTLED
        return STATE_SETTLED
