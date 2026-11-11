# VATE — Technical Implementation & Developer Reference Spec

> **Status:** Technical Addendum & Engineering Spec (Pendamping `VATE_Dev_Brief.md`)  
> **Tanggal Verifikasi Live (On-Chain & API):** 10 November 2026  
> **Target Network:** Robinhood Chain Mainnet (Chain ID `4663` / `0x1237`)  
> **Tujuan Dokumen:** Menghilangkan seluruh ambiguitas teknis (kontrak, ABI, API schema, edge cases, design tokens, animasi, dan alur transaksi) agar tim developer dapat langsung mengeksekusi pembangunan **VATE** tanpa pertanyaan pemblokir di kemudian hari.

---

## 1. Perbedaan Arsitektur: VATE vs Arcum (Penting untuk Konteks Tim)

Agar tidak terjadi salah kaprah di tim engineering:

* **VATE adalah 100% Non-Custodial Curated Vault Aggregator (Client-Side Web3 App).**
* **TIDAK PERLU:**
  * Membuat atau mendeploy smart contract baru (tidak ada kontrak vault/proxy milik VATE di fase parity).
  * Backend database, Postgres, indexer event log, keeper bot, atau server AI/LLM.
  * Menahan private key atau dana pengguna di server.
* **YANG DIBANGUN:** Aplikasi frontend modern (**Next.js App Router + TypeScript + Wagmi/Viem + TanStack Query**) yang membaca data live dari Morpho GraphQL, DeFiLlama, dan RPC Robinhood Chain, lalu menyusun transaksi bertanda tangan langsung dari wallet pengguna ke 4 kontrak **Morpho Vault V2 (ERC-4626)** yang sudah terverifikasi.

*(Opsional: boleh menggunakan Route Handler Next.js `/api/*` sebagai caching proxy read-only jika ditemukan kendala CORS atau rate-limit pada browser, namun signing dan read state posisi/allowance tetap langsung ke wallet/RPC).*

---

## 2. Hasil Verifikasi Live On-Chain (4 Vault & Hidden Traps!)

Seluruh 4 vault target telah diinspeksi langsung pada **Robinhood Chain (`4663`)** dan source code **Morpho `VaultV2.sol`** di Sourcify. Tim dev wajib memperhatikan **4 temuan kritis** di bawah ini sebelum menulis satu baris kode transaksi pun.

### A. Registry Kontrak & Hasil Inspeksi Live (10 Nov 2026)

| Vault Name | Symbol | Contract Address | Curator | Share Dec | Underlying Asset | `liquidityAdapter` | Idle USDG (On-Chain) | DeFiLlama Pool ID |
|---|---|---|---|---:|---|---|---|---|
| **Steakhouse USDG** | `steakUSDG` | `0xBeEff033F34C046626B8D0A041844C5d1A5409dd` | Steakhouse Financial | `18` | USDG (`6` dec) | `0x44ABc1d6cCFF2696d98890B92E2157AF242179c2` | ~$15.53M | `32f586b4-5358-5aa2-88ee-c842139e7023` |
| **Galaxy USDG RH Stock Tokens** | `gUSDGst` | `0xd0dACE70434fF7567b108B5a8c2a36C150C830FE` | Galaxy Curation | `18` | USDG (`6` dec) | `0x0000000000000000000000000000000000000000` **(NONE)** | ~$340.76K | `07caf4ad-86b5-5c84-adaa-84e9efc34d1a` |
| **Yearn Stonk USDG** | `ymvST-USDG` | `0x8c258F25fc6fBe3f01ccC828E2C3840A46a4a9A2` | Yearn | `18` | USDG (`6` dec) | `0x5367694e47e90ee27a8ab82f9359a9cd39e4d55e` | $0.00 | `22402907-75bd-5247-ba8f-41f35e3c8f25` |
| **Purinta USDG** | `PurintaUSDG` | `0x37788ff0c1d4e45A7FE06BC7e71e0cc00121d0A8` | Api3 | `18` | USDG (`6` dec) | `0x4e707ae2013defed0a92bd23eeb12a35cf7821f4` | $0.00 | `791ce169-afe8-58ba-b96c-c84effbc3487` |

**Token Settlement Canonical:**
* **USDG:** `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` (`decimals() === 6`).

---

### B. 4 Jebakan Teknis (Hidden Traps) yang Wajib Dihindari Dev

#### Trap 1: `maxDeposit()`, `maxWithdraw()`, dan `maxRedeem()` di Morpho `VaultV2` SELALU Mengembalikan `0`!
Hasil inspeksi source code `VaultV2.sol` yang terverifikasi di Sourcify membuktikan bahwa keempat fungsi standar ERC-4626 tersebut di-hardcode menjadi:
```solidity
/// @dev Gross underestimation because being revert-free cannot be guaranteed when calling the gate.
function maxDeposit(address) external pure returns (uint256) { return 0; }
function maxMint(address) external pure returns (uint256) { return 0; }
function maxWithdraw(address) external pure returns (uint256) { return 0; }
function maxRedeem(address) external pure returns (uint256) { return 0; }
```
* **Dampak jika dev tidak tahu:** Jika UI mengecek `if (maxDeposit(user) === 0n)` atau `if (amount > maxWithdraw(user))`, maka **semua tombol Deposit dan Withdraw akan terkunci mati selamanya**.
* **Solusi Wajib di VATE:**
  1. Jangan gunakan `maxDeposit` / `maxWithdraw` / `maxRedeem` sebagai hard blocker.
  2. Gunakan fungsi gate resmi `VaultV2`:
     * Deposit check: `canReceiveShares(user) === true` dan `canSendAssets(user) === true`.
     * Withdraw check: `canSendShares(user) === true` dan `canReceiveAssets(user) === true`.
  3. Jalankan **Pre-flight Simulation** (`publicClient.simulateContract` / `eth_estimateGas`) dengan nominal transaksi aktual tepat sebelum membuka popup wallet!

#### Trap 2: `Galaxy USDG` Tidak Punya `liquidityAdapter` (`address(0)`)
Pada kontrak `VaultV2.exit()`:
```solidity
uint256 idleAssets = IERC20(asset).balanceOf(address(this));
if (assets > idleAssets && liquidityAdapter != address(0)) {
    deallocateInternal(liquidityAdapter, liquidityData, assets - idleAssets);
}
```
* Karena `Galaxy USDG` memiliki `liquidityAdapter = 0x0000...0000`, penarikan (`withdraw`/`redeem`) hanya bisa mengambil dana yang mengendap langsung di vault (`USDG.balanceOf(galaxyVault)`, sekitar ~$340.7K per observasi, sesuai dengan `liquidityUsd` di Morpho API).
* **Solusi Wajib di VATE:** Selalu cek `USDG.balanceOf(vault)` + `liquidityAdapter()`. Jika `liquidityAdapter === zeroAddress`, maka batas aman penarikan instan adalah `USDG.balanceOf(vault)`!

#### Trap 3: Asimetri Desimal (`USDG = 6` vs `Vault Shares = 18`)
* `deposit(assets, onBehalf)` & `withdraw(assets, receiver, onBehalf)` menerima parameter **6 desimal** (`USDG`).
* `balanceOf(user)` & `redeem(shares, receiver, onBehalf)` bekerja dalam **18 desimal** (shares).
* Meskipun seluruh 4 vault saat ini memiliki `decimals() === 18`, aplikasi **wajib membaca `decimals()` dan `asset()` secara dinamis per vault saat preflight** agar tetap aman jika ada vault baru ditambahkan.

#### Trap 4: Perbedaan Unit APY & Fee antara Morpho API vs DeFiLlama API
* **DeFiLlama** (`yields.llama.fi/chart/{poolId}`): `apy`, `apyBase`, `apyReward` sudah berbentuk **persentase** (misal `7.21575` = `7.22%`).
* **Morpho GraphQL** (`api.morpho.org/graphql`): `netApy`, `performanceFee`, dan `managementFee` berbentuk **desimal fraksional** (misal `0.03909` = `3.91%`, `0.05` = `5%`).
* **Aturan wajib:** Jika DeFiLlama gagal dan fallback ke `morpho.netApy`, **kalikan `100`**. Jangan pernah memotong `performanceFee` lagi dari `netApy` karena keduanya sudah bersih (*net of fees*). Jika memakai fallback Morpho, tandai `apyBase = unknown` dan `apyReward = unknown` (jangan tampilkan `0.00%` rewards palsu!).

---

## 3. Stack, Setup, & Konfigurasi Network

### A. Tech Stack Terkunci
* **Framework:** Next.js 15+ (App Router), TypeScript (`strict: true`).
* **Web3:** `viem` v2 + `wagmi` v2 (dukung EIP-6963 multi-wallet discovery secara native).
* **State & Fetching:** `@tanstack/react-query` v5 (caching, deduplication, `refetchInterval`, `AbortSignal`).
* **Styling:** Tailwind CSS + CSS Variables (Bright Orbital light theme).
* **Motion Landing:** `gsap` (`ScrollTrigger`) + `lenis` (`smoothWheel: true`), wajib cleanup di `useEffect` (`gsap.context()`).
* **Testing:** `vitest` (unit test ranking, formatting, state machine) + `playwright` / Anvil fork test.

### B. Definisi Chain & RPC Failover (`src/config/chain.ts`)

```typescript
import { defineChain } from 'viem';

export const ROBINHOOD_CHAIN = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: {
      http: [
        'https://rpc.mainnet.chain.robinhood.com',
        'https://robinhood.drpc.org',
        'https://robinhood-rpc.publicnode.com',
      ],
    },
  },
  blockExplorers: {
    default: {
      name: 'Blockscout',
      url: 'https://robinhoodchain.blockscout.com',
    },
  },
});

export const BRIDGE_URL =
  'https://portal.arbitrum.io/bridge?destinationChain=robinhood-chain&sourceChain=ethereum';

export const USDG_CONFIG = {
  address: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168' as const,
  symbol: 'USDG',
  decimals: 6,
};
```

> **Catatan Failover RPC:** Gunakan Viem `fallback([http(rpc1), http(rpc2), http(rpc3)], { rank: false, retryCount: 2 })` agar saat salah satu RPC public timeout, client langsung pindah ke RPC berikutnya. Tampilkan host RPC yang sedang aktif di kartu statistik **Latest block**.

### C. Security Headers & CSP (`next.config.mjs`)
Pastikan domain eksternal diizinkan pada `connect-src`:
```text
connect-src 'self'
  https://api.morpho.org
  https://yields.llama.fi
  https://api.llama.fi
  https://rpc.mainnet.chain.robinhood.com
  https://robinhood.drpc.org
  https://robinhood-rpc.publicnode.com;
```

### D. Template `.env.example`
```bash
# Opsional override RPC (gunakan public failover sebagai default jika kosong)
NEXT_PUBLIC_RPC_PRIMARY=https://rpc.mainnet.chain.robinhood.com
NEXT_PUBLIC_RPC_FALLBACK_1=https://robinhood.drpc.org
NEXT_PUBLIC_RPC_FALLBACK_2=https://robinhood-rpc.publicnode.com

# Token VATE (kosongkan sebelum launch; UI akan menampilkan "Contract pending")
NEXT_PUBLIC_VATE_TOKEN_ADDRESS=

# Versi Terms & Privacy untuk invalidasi localStorage acknowledgement jika berubah
NEXT_PUBLIC_TERMS_VERSION=2026-11-10
```

---

## 4. Kontrak ABI & Allowlist Config (Siap Pakai)

### A. Allowlist Vaults (`src/config/vaults.ts`)
Alamat kontrak tujuan deposit **HARUS** berasal dari allowlist statis ini, tidak boleh ditimpa dari response API eksternal.

```typescript
export interface VaultConfig {
  address: `0x${string}`;
  llamaPoolId: string;
  name: string;
  curator: string;
  defaultShareDecimals: number;
}

export const VAULT_ALLOWLIST: readonly VaultConfig[] = [
  {
    address: '0xBeEff033F34C046626B8D0A041844C5d1A5409dd',
    llamaPoolId: '32f586b4-5358-5aa2-88ee-c842139e7023',
    name: 'Steakhouse USDG',
    curator: 'Steakhouse Financial',
    defaultShareDecimals: 18,
  },
  {
    address: '0xd0dACE70434fF7567b108B5a8c2a36C150C830FE',
    llamaPoolId: '07caf4ad-86b5-5c84-adaa-84e9efc34d1a',
    name: 'Galaxy USDG RH Stock Tokens',
    curator: 'Galaxy Curation',
    defaultShareDecimals: 18,
  },
  {
    address: '0x8c258F25fc6fBe3f01ccC828E2C3840A46a4a9A2',
    llamaPoolId: '22402907-75bd-5247-ba8f-41f35e3c8f25',
    name: 'Yearn Stonk USDG',
    curator: 'Yearn',
    defaultShareDecimals: 18,
  },
  {
    address: '0x37788ff0c1d4e45A7FE06BC7e71e0cc00121d0A8',
    llamaPoolId: '791ce169-afe8-58ba-b96c-c84effbc3487',
    name: 'Purinta USDG',
    curator: 'Api3',
    defaultShareDecimals: 18,
  },
] as const;
```

### B. ABI Terverifikasi Morpho `VaultV2` & ERC-20 (`src/abi/vaultV2.ts`)
*(Diekstrak langsung dari bytecode Sourcify Chain `4663`)*:

```typescript
export const ERC20_ABI = [
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

export const VAULT_V2_ABI = [
  // Metadata & Preflight
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  { type: 'function', name: 'asset', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'totalAssets', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'totalSupply', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'liquidityAdapter', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },

  // Morpho VaultV2 Gate Checks (WAJIB dipakai karena maxDeposit/maxWithdraw return 0)
  { type: 'function', name: 'canReceiveShares', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'canSendShares', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'canReceiveAssets', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'canSendAssets', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'bool' }] },

  // Conversions & Previews
  { type: 'function', name: 'convertToAssets', stateMutability: 'view', inputs: [{ name: 'shares', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'convertToShares', stateMutability: 'view', inputs: [{ name: 'assets', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'previewDeposit', stateMutability: 'view', inputs: [{ name: 'assets', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'previewWithdraw', stateMutability: 'view', inputs: [{ name: 'assets', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'previewRedeem', stateMutability: 'view', inputs: [{ name: 'shares', type: 'uint256' }], outputs: [{ type: 'uint256' }] },

  // Write Transactions
  {
    type: 'function',
    name: 'deposit',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'assets', type: 'uint256' },
      { name: 'onBehalf', type: 'address' },
    ],
    outputs: [{ name: 'shares', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'withdraw',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'assets', type: 'uint256' },
      { name: 'receiver', type: 'address' },
      { name: 'onBehalf', type: 'address' },
    ],
    outputs: [{ name: 'shares', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'redeem',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'shares', type: 'uint256' },
      { name: 'receiver', type: 'address' },
      { name: 'onBehalf', type: 'address' },
    ],
    outputs: [{ name: 'assets', type: 'uint256' }],
  },

  // Events untuk membaca actual amount dari Receipt Logs
  {
    type: 'event',
    name: 'Deposit',
    inputs: [
      { name: 'sender', type: 'address', indexed: true },
      { name: 'onBehalf', type: 'address', indexed: true },
      { name: 'assets', type: 'uint256', indexed: false },
      { name: 'shares', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Withdraw',
    inputs: [
      { name: 'sender', type: 'address', indexed: true },
      { name: 'receiver', type: 'address', indexed: true },
      { name: 'onBehalf', type: 'address', indexed: true },
      { name: 'assets', type: 'uint256', indexed: false },
      { name: 'shares', type: 'uint256', indexed: false },
    ],
  },
] as const;
```

---

## 5. Data Integration: Exact API Queries & Schemas

### A. Morpho GraphQL API (`https://api.morpho.org/graphql`)

**Query Wajib:**
```graphql
query GetRobinhoodVaults {
  vaultV2s(
    first: 40
    orderBy: TotalAssetsUsd
    orderDirection: Desc
    where: { chainId_in: [4663] }
  ) {
    items {
      address
      name
      listed
      totalAssetsUsd
      totalAssets
      liquidityUsd
      liquidity
      netApy
      avgNetApy
      performanceFee
      managementFee
      curators {
        items {
          name
        }
      }
      asset {
        address
        symbol
        decimals
      }
      rewards {
        asset { symbol }
        supplyApr
      }
    }
  }
}
```

**Contoh Output Aktual (10 Nov 2026):**
```json
{
  "address": "0xBeEff033F34C046626B8D0A041844C5d1A5409dd",
  "name": "Steakhouse USDG",
  "totalAssetsUsd": 539957143.65,
  "liquidityUsd": 56396397.86,
  "netApy": 0.039098,
  "performanceFee": 0,
  "managementFee": 0,
  "curators": { "items": [{ "name": "Steakhouse Financial" }] }
}
```

### B. DeFiLlama APIs
1. **APY & TVL History per Vault:** `GET https://yields.llama.fi/chart/{llamaPoolId}`
   ```typescript
   interface LlamaChartResponse {
     status: 'success' | string;
     data: Array<{
       timestamp: string; // ISO string e.g. "2026-11-10T12:01:40.716Z"
       tvlUsd: number;
       apy: number | null;
       apyBase: number | null;
       apyReward: number | null;
     }>;
   }
   ```
   * Ambil titik terakhir (`data.at(-1)`) untuk `apy`, `apyBase`, `apyReward`.
   * Filter `range` chart: `7D` (7 hari), `30D` (30 hari), `ALL` (semua).
   * Jika `data` kosong atau fetch error $\rightarrow$ fallback ke `morpho.netApy * 100`, dan **set `apyBase = null` dan `apyReward = null`** (tampilkan `Unknown` di UI agar tidak berbohong bahwa reward = `0%`).

2. **Robinhood Chain TVL:** `GET https://api.llama.fi/v2/chains`
   * Cari item dengan `x.chainId === 4663 || x.name === 'Robinhood Chain'`.
   * Nilai aktual per 10 Nov 2026: `~$1.07B` (`1068553681`).

### C. Interval Polling & Provenance
| Data | Interval Polling | Catatan UI |
|---|---|---|
| Latest Block + RPC Host | **5 detik** | Update `#sBlock` dan status badge hijau/merah |
| Wallet Balances, Allowance & Shares | **30 detik** (saat connected) | Juga paksa refresh sebelum dan sesudah transaksi |
| Morpho + DeFiLlama + Ranking + Insights | **90 detik** | Simpan `source`, `sourceTimestamp`, `fetchedAt`. **Refresh dilarang mengganti pilihan vault aktif user.** |

---

## 6. VATE Ranking Engine & Insights (Exact TypeScript Logic)

### A. Formula Deterministik VATE Ranking
Gunakan implementasi identik dengan formula referensi agar hasil skor dan urutan terverifikasi:

```typescript
export interface RankingFactors {
  depth: number;       // [0.30, 1.00]
  liquidity: number;   // [0.30, 1.00]
  liquidityUnknown: boolean;
}

export function computeVateScore(
  apyPercent: number | null,
  tvlUsd: number | null,
  liquidityUsd: number | null
): { score: number; factors: RankingFactors } {
  if (apyPercent == null || !tvlUsd || tvlUsd <= 0) {
    return {
      score: 0,
      factors: { depth: 0, liquidity: 0, liquidityUnknown: true },
    };
  }

  // $1B TVL -> 1.00 | $1M TVL -> 0.67 | <= ~$500K -> 0.30
  const depth = Math.min(1, Math.max(0.3, Math.log10(tvlUsd) / 9));

  // >= $10M withdrawable -> 1.00 | unknown -> fallback 0.60 (wajib tampil label "Unknown" di UI!)
  const liquidityUnknown = liquidityUsd == null;
  const liquidity = liquidityUnknown
    ? 0.6
    : Math.min(1, Math.max(0.3, Math.log10(Math.max(liquidityUsd, 1)) / 7));

  return {
    score: apyPercent * depth * liquidity,
    factors: { depth, liquidity, liquidityUnknown },
  };
}
```

**Unit Test Fixture (Wajib Pass di Vitest):**
* Input: `apyPercent = 7.25`, `tvlUsd = 539_900_000`, `liquidityUsd = 55_300_000`
* `depth = log10(539.9e6) / 9 ≈ 0.9702`
* `liquidity = clamp(log10(55.3e6) / 7, 0.3, 1) = 1.0`
* `score ≈ 7.25 * 0.9702 * 1.0 ≈ 7.03` (toleransi `±0.01`).
* **Tie-break:** Saat dua vault memiliki `score` sama persis, urutkan berdasarkan indeks pada `VAULT_ALLOWLIST`.
* Vault dengan `assetCheck !== 'verified'` (pending atau gagal) **tidak boleh menjadi VATE Pick** dan tombol depositnya harus disabled.

### B. VATE Reasoning & Insights Rules
1. **VATE Reasoning (Narasi Pemenang):**
   * Jelaskan skor pemenang (`APY`, `TVL`, `Withdrawable Liquidity`).
   * Cek apakah ada rival (`ranked.slice(1)`) dengan `apy > top.apy`. Jika ada, jelaskan faktor lemah rival tersebut (`depth <= liq` $\rightarrow$ *"only $X is deposited"*, else *"only $Y can be withdrawn right now"*).
   * Jika `top.apyReward > 0.05`, tambahkan catatan: *"Note: X% of its APY is temporary rewards."*
2. **VATE Insights Feed (Data Aktual Saja):**
   * Item 1: Vault dengan skor tertinggi (`VATE Pick`).
   * Per vault (hanya dibuat jika data historis tersedia):
     * **24h APY Delta:** Cari titik chart $\le \text{now} - 24\text{h}$, hitung `v.apy - d1.apy` dalam `pts`.
     * **7d TVL Delta:** Cari titik chart $\le \text{now} - 7\text{d}$, jika `|pctChange| >= 0.5%`, tampilkan `deposits grew/shrank`.
     * **Rewards Notice:** Jika `v.apyReward > 0.05`, tampilkan porsi reward vs base yield.
     * **Liquidity Warning:** Jika `v.liq / v.tvl < 0.05` (kurang dari 5% cair), tampilkan peringatan likuiditas terbatas.

---

## 7. Deposit, Withdraw, & Portfolio Tracking Specs

### A. Deposit Flow (Exact Integer Units)
1. Validasi: `amount > 0n`, `amount <= usdgBalance`, `ethBalance > 0n`, `ackChecked === true`, `vaultVerified === true`, `canReceiveShares === true`, `canSendAssets === true`.
2. Cek `allowance = USDG.allowance(account, vault.address)`:
   * Jika `allowance < amount`: kirim tx 1 `USDG.approve(vault.address, amount)` (**exact approval**, bukan `MaxUint256`) dan **tunggu `waitForTransactionReceipt` status `'success'`** sebelum lanjut ke langkah deposit.
   * Jika `allowance >= amount`: lewati langkah approve (langsung single-step deposit).
3. **Simulasi sebelum sign:** `await publicClient.simulateContract({ address: vault.address, abi: VAULT_V2_ABI, functionName: 'deposit', args: [amount, account], account })`. Jika simulasi revert, tampilkan alasan error yang ramah manusia dan **JANGAN** buka popup wallet.
4. Kirim transaksi `deposit(amount, account)`, tunggu receipt sukses, lalu parse log event `Deposit` untuk mendapat jumlah actual shares/assets.

### B. Withdraw Flow (Partial vs MAX Redeem)
* **Input UI:** Menunjukkan nilai posisi pengguna dalam USDG (`convertToAssets(balanceOf(account))`), dilengkapi shortcut `25%`, `50%`, `75%`, `MAX`.
* **Percabangan Eksekusi:**
  * Jika user klik **25 / 50 / 75%** atau mengetik nominal manual `< fullPosition`:  
    Panggil **`withdraw(assets, account, account)`**.
  * Jika user klik **MAX** (atau 100%):  
    Panggil **`redeem(allShares, account, account)`** menggunakan raw `shares` (`balanceOf(account)`) agar seluruh shares habis bersih tanpa menyisakan dust pembulatan.
* **Pengecekan Likuiditas sebelum Sign:**
  * Jika `vault.liquidityAdapter === zeroAddress` (seperti **Galaxy USDG**) dan `assets > idleUsdg`, blokir dan tampilkan peringatan kapasitas maksimal instan sebesar `idleUsdg`.
  * Tetap jalankan `simulateContract` sebelum mengirim ke wallet.

### C. Portfolio & LocalStorage Schema
* **Keys Wajib (Terpisah per Chain & Wallet):**
  * Acknowledgement Terms: `vate-ack-v1-${TERMS_VERSION}` (`boolean`)
  * Last Wallet RDNS: `vate-wallet-v1` (`string | null`)
  * Activity Log: `vate-tx-${chainId}-${account.toLowerCase()}` (`TransactionRecord[]`, maksimal **200 entri** terbaru).
* **Profit Tracking Rule:**
  $$\text{trackedProfit}_i = \text{currentAssets}_i + \text{trackedWithdrawals}_i - \text{trackedDeposits}_i$$
  * Jika terdapat shares on-chain di suatu vault, **namun tidak ada histori transaksi lokal lengkap untuk vault tersebut** (atau `trackedDeposits_i === 0n`), tampilkan **`not tracked`** (jangan tampilkan `+$currentAssets` seolah-olah seluruh modal adalah profit!).

---

## 8. Design System "Bright Orbital" & Motion Specs

Tim frontend harus mengonversi seluruh suasana gelap TOAA menjadi **Bright Orbital Light Theme** (putih gading, slate teal, sky blue) secara menyeluruh hingga ke elemen **SVG, Canvas, Chart, dan Noise Overlay**.

### A. Mapping Token Warna & CSS Variables (`globals.css`)

```css
:root {
  --bg: #F7FAF9;               /* Latar utama (menggantikan #060912) */
  --surface: #FFFFFF;          /* Card, modal, tabel (menggantikan #0b1120) */
  --surface-muted: #EDF5F3;    /* Inset panel, input, tab nonaktif */
  --text-primary: #142D35;     /* Heading, angka, body (menggantikan #ebe5d4) */
  --text-secondary: #526970;   /* Deskripsi & label */
  --text-muted: #667C82;       /* Metadata sekunder (kontras >= 4.5:1) */
  --border: #D8E5E2;           /* Divider & outline */
  --accent: #087F75;           /* CTA utama, VATE Pick, chart line (menggantikan #5ef0c4) */
  --accent-hover: #06665F;
  --accent-soft: #DDF6EC;      /* Pick badge background */
  --accent-secondary: #2487D8; /* Segmen lent out & aksen data kedua */
  --sky-soft: #E5F2FD;         /* Glow dekoratif biru */
  --success: #137A56;
  --warning: #986300;
  --error: #C13C4B;
}
```

### B. Penyesuaian Visual Dekoratif pada Light Theme (Wajib!)
1. **Canvas Starfield & Armillary Sphere (Hero):**
   * Jangan me-render titik bintang berwarna putih/ivory (`#ebe5d4`) di atas latar `#F7FAF9` karena tidak akan terlihat!
   * Ubah warna lintasan orbit dan bintang menjadi `#142D35` dengan opacity rendah (`0.08` – `0.25`), dan packet/node aktif menjadi `#087F75` (teal) serta `#2487D8` (sky blue).
   * Radial glow hero gunakan `rgba(36, 135, 216, 0.10)` (sky-soft) ke transparan.
2. **Chart Area Gradient & Crosshair:**
   * Garis APY: `#087F75` (`stroke-width: 2px`).
   * Fill gradient bawah kurva: `#087F75` opacity `0.18` $\rightarrow$ `0`.
   * Tooltip chart gunakan `background: #FFFFFF`, border `#D8E5E2`, text `#142D35` dengan `box-shadow` lembut.
3. **Noise Overlay:** Jika memakai SVG fractalNoise, turunkan opacity menjadi sangat halus (`0.02` – `0.03`) dengan warna gelap tipis agar `#F7FAF9` terasa bersih, bukan kotor.
4. **Tipografi:**
   * Google Fonts: `Archivo` (`wdth 62..125, wght 100..900`), `Instrument Serif` (italic untuk aksen *"in orbit"*, *"Portfolio"*, narasi VATE Reasoning), dan `JetBrains Mono` (`400;500`).

### C. Layout Breakpoints & Responsiveness
* **Desktop (`> 1200px`):** Grid 3 kolom `grid-template-columns: 300px minmax(0, 1fr) 390px; gap: 16px;` (kiri daftar vault ~23%, tengah detail ~44%, kanan panel transaksi ~30%).
* **Tablet (`<= 1200px`):** `grid-template-columns: 270px minmax(0, 1fr);` panel transaksi berpindah full-width di bawah (`grid-column: 1 / -1`).
* **Mobile (`<= 860px`):** `1 kolom`. Panel transaksi naik ke paling atas (`order: -1`) agar form selalu mudah diakses, daftar vault menjadi horizontal snap carousel (`scroll-snap-type: x mandatory`).

### D. Landing Page Components & Audio Parity
* **Intro Screen:** Astrolabe berputar dengan progress `000`–`100` (klik atau lewati otomatis saat `prefers-reduced-motion: reduce`).
* **Year Ruler & HUD:** Track tahun `1571 AD` – `1630 AD` di sisi kiri yang sinkron dengan scroll progress Lenis, dan floating HUD di bawah yang memanggil skor VATE Pick live.
* **Web Audio Ambient Synthesizer:** Implementasikan menggunakan Web Audio API (`AudioContext` + `BiquadFilterNode` + 5 oscillator `[55, 82.4, 110, 164.8, 220] Hz` + sine click tick `2600 -> 900 Hz`) — **tidak butuh file `.mp3` eksternal**, hanya dimulai setelah user klik tombol toggle Sound.

---

## 9. Pembagian Tugas Tim Dev (Sprint Action Plan)

| Role | Fokus Pekerjaan | Kriteria Selesai (DoD) |
|---|---|---|
| **Dev 1 — Web3 & Core Data** | `chain.ts`, `vaultV2.ts`, adapter Morpho GraphQL + DeFiLlama, preflight contract checks, ranking formula + unit tests, EIP-6963 wallet connector, deposit/withdraw state machine, `localStorage` portfolio/activity. | Seluruh unit test formula (`7.03` fixture, decimals `6`/`18`) pass; deposit (exact approve), partial withdraw, MAX redeem, dan simulasi error berjalan mulus di fork Anvil / testnet wallet uji. |
| **Dev 2 — UI Workspace (`/app` & `/docs`)** | Konversi Bright Orbital theme, 3-kolom workspace responsive (`1440`/`1280`/`768`/`390` px), SVG APY chart + crosshair tooltip, liquidity bar, VATE Reasoning & Insights feed, modal transaksi step-by-step, Portfolio tab, Docs/Terms/Privacy. | Semua state tabel wallet (disconnected, wrong network, zero ETH, balance kurang, capacity limit, revert) teruji tanpa scroll horizontal dan kontras $\ge 4.5:1$. |
| **Dev 3 — Landing Page & Motion (`/`)** | Intro Astrolabe, Hero 3D Canvas Armillary Sphere, GSAP ScrollTrigger + Lenis cleanup, 5 expandable feature rows, 6 ecosystem items, 4 stacked principle cards, HUD + Year Ruler, Web Audio synth, Token widget (`Contract pending`). | 60fps smooth scroll, zero memory leak saat route transition ke `/app`, dan seluruh konten tetap terbaca/berfungsi saat `reduced-motion` aktif. |

