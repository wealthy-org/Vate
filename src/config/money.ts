// Imported for its side effect by the app shell. Testnet amounts are valueless test units, so the
// UI writes them as "5.3M tUSDG" and never with a dollar sign. Mainnet keeps "$5.3M".
import { setMoneyStyle, USD_STYLE } from '@/lib/format';
import { NETWORK } from './networks';

setMoneyStyle(NETWORK.isTestnet ? { prefix: '', suffix: ` ${NETWORK.asset.symbol}` } : USD_STYLE);
