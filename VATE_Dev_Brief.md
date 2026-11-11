# VATE — Developer Brief

**Referensi utama:** [TOAA Finance](https://toaa.finance/)  
**Tanggal observasi:** 10 November 2026  
**Arahan owner:** buat copycat dengan fungsi, struktur halaman, layout, interaksi, dan pengalaman penggunaan mengikuti TOAA sedekat mungkin. Perubahan yang diminta: **nama menjadi VATE dan warna menjadi lebih terang**. Fitur tambahan dibahas setelah parity selesai.

## 1. Keputusan produk

VATE adalah antarmuka non-custodial untuk menemukan, membandingkan, melakukan deposit, dan menarik USDG dari curated lending vaults di **Robinhood Chain**, mengikuti chain referensi. Dana dikirim langsung dari wallet pengguna ke vault pihak ketiga; shares vault menjadi bukti posisi pengguna.

Produk terdiri dari landing page bergaya astronomi/orbital, aplikasi Vaults dan Portfolio, serta Docs, Terms, dan Privacy. Ranking membantu pengguna memilih berdasarkan APY, kedalaman deposit, dan likuiditas. Pengguna tetap memilih vault dan menandatangani setiap transaksi.

**Target handoff adalah aplikasi fungsional dengan data nyata dan transaksi yang tervalidasi.** Tampilan saja belum memenuhi brief ini. VATE menggunakan vault yang tersedia pada chain referensi; tidak perlu membangun ulang lending protocol atau menyediakan modal untuk mendanai seluruh deposit pengguna.

### Batas perubahan

| Bagian | Instruksi |
|---|---|
| Brand | TOAA / Toaa Finance → VATE; wordmark VATE di seluruh halaman, metadata, dan modal |
| Nama fitur | Kepler pick / reasoning / insights → VATE Pick / VATE Reasoning / VATE Insights; peran dan perilaku sama |
| Visual | Terapkan light theme di seluruh produk, pertahankan komposisi, tipografi, ilustrasi orbital, dan motion referensi |
| Fungsi | Replikasi katalog vault, ranking, chart, wallet, deposit, withdraw, portfolio, dan activity |
| Chain dan aset | Robinhood Chain, ETH untuk gas, USDG untuk deposit; validasi konfigurasi sebelum transaksi diaktifkan |
| Bahasa UI | Bahasa Inggris seperti referensi; brief ini berbahasa Indonesia untuk tim |
| Monetisasi | Platform fee 0 pada baseline, sesuai FAQ TOAA; fee vault dan gas tetap ditampilkan |
| Penambahan fitur | Auto-rebalance, chat AI, multichain, swap terintegrasi, lending pool sendiri, dan strategi leverage menunggu arahan berikutnya |

## 2. Referensi yang wajib dibuka developer

| Referensi | URL | Yang diikuti |
|---|---|---|
| Landing | https://toaa.finance/ | Intro, hero orbital, urutan section, motion, navigasi, footer |
| Aplikasi | https://toaa.finance/app | Vaults, detail, ranking, deposit/withdraw, portfolio, state dan modal |
| Dokumentasi | https://toaa.finance/docs | Perilaku transaksi, formula, network, daftar vault, FAQ |
| Terms | https://toaa.finance/terms | Cakupan informasi dan disclosure; isi disesuaikan dengan operator VATE |
| Privacy | https://toaa.finance/privacy | Penyimpanan lokal dan layanan eksternal; isi sesuai implementasi VATE |
| Morpho vault referensi | https://app.morpho.org/robinhood-chain/vault/0xBeEff033F34C046626B8D0A041844C5d1A5409dd/steakhouse-usdg | Pemeriksaan silang identitas vault Steakhouse |
| Morpho Vaults API | https://docs.morpho.org/developers/api/morpho-vaults/ | Integrasi data; cek schema terbaru |
| Morpho Vaults V2 | https://docs.morpho.org/developers/contracts/morpho-vaults-v2/ | Perilaku kontrak dan integrasi vault |
| ERC-4626 | https://eips.ethereum.org/EIPS/eip-4626 | Semantik assets/shares, preview, deposit, withdraw, redeem |

**Dasar riset:** landing, aplikasi disconnected, pergantian Vaults/Portfolio dan Deposit/Withdraw, Docs dan FAQ biaya diperiksa langsung. HTML/JavaScript publik halaman juga diperiksa untuk formula, sumber data, refresh interval, wallet discovery, dan jalur transaksi. Tidak ada wallet yang dihubungkan atau transaksi yang dikirim dalam riset ini. Alur transaksi bertanda tangan diketahui dari dokumentasi dan implementasi publik, belum dibuktikan dengan eksekusi onchain.

Tidak ditemukan repository TOAA yang terverifikasi melalui halaman yang diperiksa. Implementasikan source VATE sendiri; jangan mengasumsikan repository bernama mirip adalah source TOAA.

## 3. Visual direction — bright orbital

Pertahankan bahasa visual astronomi: astrolabe, garis orbit, titik navigasi, starfield, grid halus, koordinat, ruler tahun, dan label monospace. Ubah suasana gelap TOAA menjadi **putih gading dengan teal dan sky blue**. Ini merupakan arahan warna baru VATE, bukan warna yang ditemukan pada referensi.

### Design tokens

| Token | Hex | Pemakaian |
|---|---|---|
| `background` | `#F7FAF9` | Latar utama seluruh halaman |
| `surface` | `#FFFFFF` | Card, form, modal, tabel |
| `surface-muted` | `#EDF5F3` | Inset panel, input, tab nonaktif |
| `text-primary` | `#142D35` | Heading, angka utama, body utama |
| `text-secondary` | `#526970` | Deskripsi dan label |
| `text-muted` | `#667C82` | Metadata sekunder yang tetap terbaca |
| `border` | `#D8E5E2` | Divider dan outline card |
| `accent` | `#087F75` | CTA utama, selected state, tautan, yield line |
| `accent-hover` | `#06665F` | Hover tombol utama |
| `accent-soft` | `#DDF6EC` | Pick badge, panel pilihan |
| `accent-secondary` | `#2487D8` | Segmen lending dan elemen data kedua |
| `sky-soft` | `#E5F2FD` | Glow / bidang dekoratif biru |
| `success` | `#137A56` | Status confirmed |
| `warning` | `#986300` | Likuiditas terbatas / perhatian |
| `error` | `#C13C4B` | Error / transaksi gagal |

CTA utama: latar teal, teks putih. Badge VATE Pick: mint pucat, teks teal gelap. Vault terpilih: border teal dan tint mint tipis. Liquidity bar: teal untuk withdrawable, biru untuk lent out; selalu sertakan label dan nilai.

Orbit dan grid memakai slate/teal dengan opacity rendah di atas latar terang. Sesuaikan semua hard-coded fill, stroke, gradient, canvas stars, chart tooltip, dan noise overlay; mengganti background saja tidak cukup. Noise sangat ringan, hindari membuat panel terlihat kotor atau teks redup. Pastikan kontras teks normal minimal 4.5:1 dan kontrol/fokus terbaca.

### Tipografi dan bentuk

- **Archivo variable** untuk display, body, dan angka utama; pertahankan heading uppercase lebar dari TOAA.
- **Instrument Serif italic** untuk aksen seperti “in orbit”, judul Portfolio, dan narasi ranking.
- **JetBrains Mono** untuk label kecil, koordinat, score, alamat, dan timestamp.
- Pertahankan kombinasi outline heading dan solid heading pada landing, ukuran besar, whitespace, CTA pill, card aplikasi sekitar 14–16 px radius, garis pemisah tipis.
- Acuan desktop: gutter sekitar 28–40 px, header aplikasi sekitar 68 px, gap panel sekitar 16 px. Cocokkan terhadap referensi pada viewport sama sebelum finalisasi.
- Buat lockup/ikon orbital milik VATE dengan tingkat detail sepadan. Nama, logo TOAA, akun sosial, dan kontrak token TOAA tidak dipakai sebagai identitas VATE.

Light theme menjadi tampilan default landing, app, Docs, Terms, Privacy, modal, dan loading screen. Theme toggle tidak perlu ditambahkan pada rilis parity.

## 4. Sitemap dan landing page

| Route | Isi |
|---|---|
| `/` | Landing lengkap dengan intro dan semua section |
| `/app` | Vaults dan Portfolio sebagai tab dalam aplikasi |
| `/docs` | Dokumentasi dan FAQ |
| `/terms` | Terms VATE |
| `/privacy` | Privacy VATE |

Pertahankan urutan landing:

1. **Intro / click to enter:** astrolabe beranimasi di tengah, progress 000–100, teks masuk, transisi menuju hero. Halaman tetap dapat diakses ketika motion dikurangi atau aset dekorasi gagal dimuat.
2. **Header:** ikon brand di kiri; Home, Features, Ecosystem, Docs; toggle ambient sound dan Launch App di kanan. Active navigation mengikuti posisi scroll.
3. **Hero:** globe/orbit besar, grid koordinat, titik dan label vault/wallet/USDG, heading dua tingkat dengan baris outline dan solid, deskripsi produk, area contract widget, scroll hint.
4. **Core logic:** astrolabe besar dan penjelasan ranking serta custody, dengan komposisi teks dua kolom seperti referensi.
5. **Automation and Simplicity:** judul oversized sans + serif italic, ilustrasi orbit dan penjelasan research assistance. Copy tidak menjanjikan perpindahan dana otomatis.
6. **Lima feature rows:** Robinhood Chain Native, Real Yield, VATE Ranking, Non-Custodial, Curated Vaults Only. Pertahankan nomor 01/05, expandable content, highlight, dot, dan progress line.
7. **Ecosystem:** heading wallet/yield dan grid dua kolom berisi Robinhood Chain, USDG, Curated Vaults, Your Wallet, Blockscout Explorer, Arbitrum Bridge. Pertahankan perilaku expand/hover/tap; wording menjelaskan integrasi aktual.
8. **Empat principle cards:** non-custodial, user signs, curated vaults, transparency; tumpukan kartu angka Romawi, tombol Next, counter, dan pergantian judul/deskripsi.
9. **Footer:** grid informasi/link, widget kontrak jika sudah tersedia, sosial VATE, copyright, wordmark VATE besar.
10. **HUD:** year ruler/progress di sisi kiri dan pick ticker di bawah. HUD mengambil hasil ranking yang sama dengan app.

### Motion parity

Replikasi transisi intro, rotating astrolabe/orbits, moving nodes, scroll-linked progress, reveal heading, feature highlight, ecosystem expansion, stacked-card transition, hover CTA, dan HUD update. Referensi memakai GSAP/ScrollTrigger dan Lenis pada landing; stack yang sama dapat digunakan dalam versi VATE dengan lifecycle cleanup.

Ambient audio dimulai setelah interaksi pengguna dan bisa dimute. Reduced-motion mengurangi animasi berulang serta typing effect. Pada touch gunakan tap, dan cursor custom hanya aktif pada pointer yang sesuai. Animasi dekoratif tidak boleh menghambat form atau navigasi.

## 5. Aplikasi Vaults — struktur yang harus sama

### Header dan overview

- Brand VATE di kiri, segmented tabs Vaults / Portfolio.
- Docs, network indicator, Connect wallet / address menu di kanan.
- Headline produk dengan serif italic pada frasa aksen.
- Empat overview cards: **Robinhood Chain TVL**, **USDG in these vaults**, **VATE Pick APY**, **Latest block** dengan RPC host.
- Chain TVL mencakup chain; curated TVL adalah jumlah vault yang ditampilkan. Jangan menyamakan keduanya atau menyebut nilai ini sebagai TVL milik VATE.

### Workspace desktop tiga kolom

Gunakan proporsi awal sekitar **23% daftar / 44% detail / 30% transaksi**, sisanya gap. Cocokkan proporsi dan breakpoint dengan referensi.

**Kiri — daftar empat vault:** nama, curator, aset USDG, total APY, TVL, selected outline, dan badge VATE Pick pada pemenang ranking. Urutan dasar katalog mengikuti referensi; tabel reasoning diurutkan menurut score. Klik card mengganti detail, form tujuan, allowance, dan posisi terkait.

**Tengah — detail vault:** curator, nama, Contract explorer link; Total APY, Base/Rewards, TVL, Performance Fee; APY history dengan 7D / 30D / ALL; crosshair/tooltip dengan tanggal dan breakdown; liquidity bar withdrawable versus lent out; metadata kontrak vault, underlying asset, onchain check, score, ERC-4626, dan refresh status.

**Ranking/reasoning:** status scanning → hasil; penjelasan pemenang; tabel semua vault dengan rank, yield, depth, liquidity, score dan factor bars; formula di bawah. Klik baris memilih vault yang sama pada seluruh workspace. Pertahankan reveal bertahap dan efek mengetik secukupnya, dengan teks lengkap langsung pada reduced-motion.

**Insights feed:** pick saat ini, perubahan APY 24 jam dalam percentage points, perubahan TVL 7 hari, komponen rewards, dan likuiditas rendah. Sumbernya perubahan data aktual; item yang datanya belum tersedia tidak dibuat-buat.

**Kanan — panel transaksi:** tab Deposit/Withdraw, amount USDG, balance, MAX, estimasi dolar, arah dana/nama vault, transaction plan, summary, gas label, acknowledgement sesuai mode, CTA stateful, serta bantuan bridge pada Deposit.

## 6. Ranking engine — parity yang terukur

Implementasi publik TOAA memakai formula deterministik. Fitur inti ini tidak memerlukan LLM, model trading, atau agent yang memegang wallet.

```text
APY = total APY dalam percentage points; 7.25 berarti 7.25%
Depth = clamp(log10(TVL_USD) / 9, 0.30, 1.00)
Liquidity = clamp(log10(max(Withdrawable_USD, 1)) / 7, 0.30, 1.00)
Score = APY × Depth × Liquidity
```

TVL $1B mencapai depth 1; likuiditas $10M mencapai liquidity 1. Sebagai fixture perhitungan, APY 7.25%, TVL $539.9M, likuiditas $55.3M menghasilkan score sekitar 7.03. Angka ini adalah contoh hasil observasi, bukan nilai yang harus di-hardcode pada produksi.

Source referensi memberi score 0 ketika APY/TVL tidak tersedia dan memakai liquidity factor 0.6 ketika likuiditas tidak diketahui. Pada VATE, nilai unknown wajib terlihat sebagai unknown, termasuk bila fallback 0.6 dipertahankan untuk perhitungan. Vault dengan asset check gagal tidak layak menerima deposit; status verifikasi pending harus dibedakan dari verified.

Penjelasan pemenang disusun dari data dan formula: APY, deposit depth, exit liquidity, alasan vault APY lebih tinggi bisa kalah, serta bagian rewards yang temporer. Teks tidak boleh menyimpulkan bahwa pemenang mengungguli semua faktor jika data hanya membuktikan score tertinggi. Gunakan tie-break deterministik, misalnya urutan allowlist, saat score sama.

Refresh ranking, detail, dan insights setiap **90 detik**, balance/posisi sekitar **30 detik** saat connected, latest block sekitar **5 detik**. Tampilkan timestamp data; hasil refresh tidak mengganti pilihan vault pengguna secara otomatis.

## 7. Deposit flow

1. Pengguna membuka vault; vault dan chain diverifikasi; data tetap bisa dibaca tanpa wallet.
2. Connect wallet via provider browser, pilih akun, lalu switch/add network bila diperlukan.
3. Masukkan amount USDG atau MAX dari balance aktual. Amount memakai integer units, bukan floating-point untuk transaksi.
4. Tampilkan tujuan vault, jumlah, estimasi tahunan/harian, APY saat ini, gas ETH, dan rencana transaksi.
5. Risk acknowledgement disimpan lokal setelah disetujui; gunakan key VATE dan versi Terms.
6. Refresh balance, allowance, chain, asset, dan kapasitas deposit sebelum eksekusi.
7. Bila allowance kurang: **approve tepat sebesar amount** ke vault terpilih, tunggu receipt sukses. Bila allowance cukup, lewati langkah approve.
8. Simulasikan deposit memakai kondisi terbaru, lalu wallet menandatangani `deposit(assets, receiver)` dengan receiver akun pengguna.
9. Tampilkan confirmation modal per langkah: waiting → wallet confirmation → pending + explorer → confirmed atau failed/rejected.
10. Setelah receipt sukses, refresh balance, shares, asset value, portfolio, dan activity. Jangan menampilkan deposit berhasil hanya karena approval berhasil.

Kontrak VATE tidak perlu menjadi perantara dana. Deposit langsung ke vault referensi yang sudah diverifikasi. Estimasi tahunan untuk parity: amount × APY / 100; estimasi harian: hasil tahunan / 365. Beri label estimasi berdasarkan APY kini dan asumsi USDG ≈ $1, bukan jaminan atau harga pasar live.

## 8. Withdraw flow

- Tab Withdraw menunjukkan nilai posisi vault dalam USDG, bukan wallet balance.
- Amount manual dan shortcut 25 / 50 / 75 / MAX seperti referensi.
- Partial withdrawal menggunakan `withdraw(assets, receiver, owner)` dengan receiver dan owner akun pengguna.
- MAX menggunakan `redeem(allShares, receiver, owner)` untuk menutup seluruh shares, menghindari dust akibat pembulatan asset amount.
- Sebelum kirim: cek ulang posisi, chain, kapasitas keluar pengguna, likuiditas dan simulasi. MAX perlu full-redeem capacity; jika tidak cukup, jelaskan kapasitas partial yang tersedia.
- Tampilkan estimasi USDG diterima, liquidity vault saat ini, gas ETH, dan single-step transaction plan.
- Tunggu receipt sukses lalu refresh posisi dan catat actual amounts dari receipt/event jika tersedia.

Nilai likuiditas agregat API membantu konteks; jangan menjadikannya satu-satunya dasar kapasitas withdrawal pengguna. Verifikasi `maxWithdraw` / `maxRedeem` dan semantik vault konkret; gunakan simulasi terbaru sebagai pemeriksaan eksekusi. Bila vault membutuhkan data adapter atau jalur likuiditas khusus, selesaikan integrasi menurut kontrak tersebut sebelum deposit produksi dibuka.

## 9. Portfolio dan activity

Tiga summary cards: Total in Vaults, Estimated Earnings/Day, Blended APY. Tabel posisi: Vault, Shares, Value (USDG), Profit (Tracked), APY, Action. Tabel activity: Time, Type, Vault, Amount, Tx. Tautan all activity membuka explorer akun.

```text
assets_i = convertToAssets(balanceOf(user)) untuk setiap vault
total = sum(assets_i)
blendedAPY = sum(assets_i × APY_i) / total
estimatedDaily = sum(assets_i × APY_i / 100 / 365)
trackedProfit_i = currentAssets_i + trackedWithdrawals_i − trackedDeposits_i
```

Saldo posisi dibaca langsung dari chain. Profit mengikuti keterbatasan referensi: activity aplikasi tersimpan pada browser dan akun terkait, bukan cost basis universal. Posisi dari luar aplikasi atau histori yang tidak lengkap ditandai **not tracked / incomplete**, meskipun nilai posisi tetap ditampilkan. Adanya satu transaksi lokal tidak cukup untuk membuktikan cost basis lengkap.

Gunakan key terpisah per chain + wallet + vault. Activity mencatat receipt yang benar-benar sukses, termasuk actual assets hasil redeem; dapat dibatasi 200 entri seperti implementasi referensi. Withdraw dari tabel membuka Vaults dengan vault dan mode yang tepat. Empty state dibedakan antara disconnected, connected tanpa posisi, dan gagal membaca chain.

## 10. Wallet dan transaction states

Gunakan EIP-6963 untuk multi-wallet discovery dan EIP-1193 provider; dukung MetaMask, Rabby, serta injected wallet lain yang kompatibel. Silent reconnect hanya ke sesi yang sudah disetujui, tanpa membuka popup berulang.

| State | Perilaku wajib |
|---|---|
| Disconnected | Statistik/vault tetap terbaca; CTA Connect wallet; portfolio meminta koneksi |
| Wallet tidak terpasang | Modal menjelaskan dan memberi link wallet resmi |
| Wrong network | Badge dan CTA switch/add chain; jangan kirim transaksi |
| Loading / checking asset | Skeleton atau label checking; transaksi deposit menunggu verifikasi |
| Asset mismatch / invalid contract | Tandai gagal dan blok deposit |
| Amount kosong / invalid / melebihi balance | Pesan spesifik dan CTA sesuai konteks |
| ETH gas tidak cukup | Jelaskan kebutuhan ETH; tampilkan error dari estimasi secara jelas |
| Kapasitas deposit/withdraw terbatas | Amount yang dapat dieksekusi dijelaskan; blok rencana yang sudah diketahui gagal |
| Approval / deposit / withdraw pending | Status dan explorer per tx; cegah submit ganda |
| Rejected wallet request | Hentikan langkah aktif; state form tetap dapat dipulihkan |
| Revert sebelum broadcast | Tampilkan alasan; transaksi belum dikirim |
| Revert pada receipt | Tampilkan failed beserta hash; jangan klaim dana masuk/keluar |
| Confirmation timeout | Pertahankan hash dan status pending/unknown, lanjutkan rekonsiliasi; hindari duplikasi transaksi |
| RPC / data API bermasalah | Pisahkan status koneksi chain dan freshness data; unknown tampil sebagai unknown |
| Akun/chain berubah | Reset data terkait akun dan cek ulang sebelum setiap transaksi berikutnya |

Modal akun menyediakan copy address, explorer, dan disconnect. Modal wallet/transaksi mendukung keyboard, Escape sesuai konteks, focus trap, dan pengembalian fokus. Disconnect aplikasi tidak boleh diklaim sebagai pencabutan allowance onchain.

## 11. Network dan kontrak referensi

**Data berikut berasal dari Docs dan konfigurasi publik TOAA pada tanggal observasi. Ini daftar referensi implementasi; validasi deployment dan ABI aktual sebelum write transactions diaktifkan.**

| Konfigurasi | Nilai referensi |
|---|---|
| Network | Robinhood Chain |
| Chain ID | `4663` / `0x1237` |
| Gas | ETH |
| RPC utama di Docs | `https://rpc.mainnet.chain.robinhood.com` |
| RPC fallback di source | `https://robinhood.drpc.org`, `https://robinhood-rpc.publicnode.com` |
| Explorer | `https://robinhoodchain.blockscout.com` |
| Bridge | `https://portal.arbitrum.io/bridge?destinationChain=robinhood-chain&sourceChain=ethereum` |
| USDG | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` |
| USDG decimals di source | 6; baca ulang `decimals()` onchain |

| Vault | Curator referensi | Alamat |
|---|---|---|
| Steakhouse USDG | Steakhouse Financial | `0xBeEff033F34C046626B8D0A041844C5d1A5409dd` |
| Galaxy USDG RH Stock Tokens | Galaxy Curation | `0xd0dACE70434fF7567b108B5a8c2a36C150C830FE` |
| Yearn Stonk USDG | Yearn | `0x8c258F25fc6fBe3f01ccC828E2C3840A46a4a9A2` |
| Purinta USDG | Api3 | `0x37788ff0c1d4e45A7FE06BC7e71e0cc00121d0A8` |

Preflight developer: `eth_chainId`, bytecode kontrak, `asset()`, asset/share `decimals()`, metode ERC-4626/ABI, preview, kapasitas, dan simulasi. Source TOAA mengasumsikan share decimals 18; VATE membacanya per vault. API hanya boleh memperbarui metadata/statistik, tidak mengubah destination contract di luar allowlist yang ditinjau.

### Widget token VATE

TOAA menampilkan token CA di hero dan footer. Buat komponen sepadan untuk VATE dengan copy address dan explorer yang mengambil konfigurasi VATE sendiri. **Belum ada alamat kontrak, tokenomics, domain, atau akun sosial VATE yang diberikan.** Jangan memakai CA TOAA atau alamat placeholder yang tampak valid. Sampai kontrak VATE tersedia, tampilkan status “Contract pending” dengan copy/explorer nonaktif. Peluncuran token merupakan pekerjaan terpisah dari brief aplikasi ini; token tidak menjadi syarat deposit USDG ke vault.

## 12. Data integration dan arsitektur

### Sumber yang ditemukan pada implementasi TOAA

| Data | Sumber referensi |
|---|---|
| Vault identity, TVL, liquidity, fee, fallback APY | `https://api.morpho.org/graphql`, query `vaultV2s` dengan filter chain ID |
| APY history, base/reward split | `https://yields.llama.fi/chart/{poolId}` |
| Chain TVL | `https://api.llama.fi/v2/chains` |
| Blocks, balances, allowance, shares, asset checks, transaction receipts | JSON-RPC chain / wallet provider |

Mapping DeFiLlama yang tertanam pada source referensi:

| Vault | Pool ID |
|---|---|
| Steakhouse USDG | `32f586b4-5358-5aa2-88ee-c842139e7023` |
| Galaxy USDG RH Stock Tokens | `07caf4ad-86b5-5c84-adaa-84e9efc34d1a` |
| Yearn Stonk USDG | `22402907-75bd-5247-ba8f-41f35e3c8f25` |
| Purinta USDG | `791ce169-afe8-58ba-b96c-c84effbc3487` |

Verifikasi setiap mapping berdasarkan chain, alamat, aset, dan freshness. Source memakai APY histori terbaru DeFiLlama dengan fallback Morpho net APY; interval polling 90 detik tidak menjamin timestamp underlying data juga baru. Simpan `source`, `sourceTimestamp`, dan `fetchedAt`. Jika split base/rewards tidak diketahui, tampilkan unknown; jangan menyimpulkan reward nol karena sumber fallback hanya mengembalikan net APY. Pastikan fee tidak dipotong dua kali dari APY net.

### Stack yang disarankan

- Next.js + TypeScript; komponen terpisah untuk landing, workspace, wallet modal, transaction modal, dan portfolio.
- Tailwind atau CSS variables dengan tokens terang; GSAP/ScrollTrigger + Lenis untuk landing; SVG/Canvas untuk orbit dan chart sesuai kebutuhan fidelity.
- Viem + wagmi atau integrasi provider setara, memakai ABI bertipe dan BigInt untuk nominal. Jangan merakit calldata manual bila library ABI sudah tersedia.
- Adapter Morpho, DeFiLlama, dan RPC; TanStack Query atau setara untuk caching, polling, abort, retry terbatas, dan state sumber data.
- Read-only API/cache tipis boleh dipakai untuk mengurangi request dan mengatasi CORS/rate limit. Semua signing tetap di wallet; server tidak memegang private key atau dana.
- Local storage untuk acknowledgement versi Terms, preferensi wallet/sound, serta activity lokal. Tidak perlu akun email atau database pengguna untuk parity dasar.

Model minimum: `ChainConfig`, `AssetConfig`, `VaultConfig`, `VaultSnapshot`, `ApyPoint`, `RankingResult`, `WalletPosition`, `TransactionRecord`. Pisahkan kontrak yang diperbolehkan dari data yang berubah. Semua nilai transaksi disimpan sebagai integer string; nilai USD analitik boleh desimal dengan satuan eksplisit.

Tidak diperlukan kontrak custody, pool baru, keeper, atau backend AI untuk menghasilkan perilaku TOAA yang diamati. Bila integrasi vault aktual membutuhkan adapter tambahan, implementasikan kebutuhan spesifik tersebut dan dokumentasikan sebabnya.

## 13. Docs, Terms, Privacy

Docs memakai struktur referensi: introduction, getting started, depositing, withdrawing, scoring, APY, portfolio, risks, network/contracts, FAQ. FAQ menjawab biaya, custody, aset yang didukung, wrong network, simulation failure, dan apakah ranking memindahkan dana otomatis.

Pertahankan side navigation/anchor, tabel faktor, tabel kontrak, FAQ accordion dan layout editorial. Tulis ulang memakai identitas VATE dan kondisi implementasi nyata. Terms/Privacy harus memakai operator, kontak, hosting, tanggal berlaku, dan layanan VATE; jangan menyalin placeholder operator referensi. Jelaskan bahwa provider RPC/API dapat menerima alamat publik dan metadata request; activity lokal hanya bertahan pada browser tersebut.

## 14. Responsiveness dan aksesibilitas

Desktop mempertahankan tiga kolom. Pada tablet gunakan dua kolom atau stacking sesuai perilaku referensi. Pada mobile susun panel tanpa kehilangan akses ke vault selector, detail, transaction controls, reasoning dan portfolio; pertahankan prioritas form referensi pada breakpoint kecil. Tidak ada scroll horizontal halaman; tabel boleh menjadi area scroll terlabel.

Uji sekurangnya 1440, 1280, 768, dan 390 px. Pastikan heading outline tetap terbaca pada light background, label ticker dan ranking tidak menimpa angka, input tidak tertutup keyboard, tooltip tersedia lewat tap/fokus, dan fokus keyboard terlihat. Seluruh halaman tetap dapat digunakan tanpa animasi atau audio.

## 15. Urutan kerja dan deliverables

1. **Reference mapping:** inventaris semua route, section, state, screenshot pembanding internal, dan konfigurasi sumber. Konfirmasi alamat dan kemampuan vault sebelum mengaktifkan transaksi.
2. **Visual parity:** landing lengkap dan aplikasi light theme VATE, termasuk responsive, intro, orbit, cards, chart, dan modal.
3. **Read integration:** data nyata, ranking deterministik, insights, history, timestamp, fallback, dan error states.
4. **Wallet dan writes:** network handling, exact approval, deposit, partial withdraw, MAX redeem, receipt handling, dan portfolio.
5. **QA dan handoff:** pengujian finansial, verifikasi visual lintas viewport, build, deployment staging, dan dokumentasi operasi.

Serahkan repository source VATE, konfigurasi environment contoh tanpa secret, daftar kontrak/ABI tervalidasi, dokumentasi API/mapping, instruksi menjalankan/build/deploy, link staging, hasil QA, dan daftar dependency yang benar-benar belum tersedia. Approval deploy produksi dan penyiapan token dapat dilakukan setelah hasil konkret dapat direview.

## 16. Acceptance checklist

### Parity produk dan visual

- [ ] Semua route dan section TOAA yang disebut dalam brief tersedia pada VATE.
- [ ] Layout, hierarki, pilihan vault, chart, ranking, transaksi, dan portfolio mengikuti referensi.
- [ ] Light theme diterapkan konsisten, termasuk SVG/Canvas, tooltip, skeleton, modal, dan legal pages.
- [ ] Seluruh branding pengguna menjadi VATE; link referensi hanya berada pada dokumentasi tim bila relevan.
- [ ] Tidak ada TOAA CA, akun sosial TOAA, statistik hard-coded, fake APY, atau tombol transaksi yang hanya dekoratif.
- [ ] Navigasi, intro, audio, motion, reduced-motion dan interaksi touch/keyboard berfungsi.

### Data dan transaksi

- [ ] Ranking menghasilkan fixture sekitar 7.03 di atas dan faktor dapat direproduksi.
- [ ] Vault selection sinkron dengan detail, form, balance/allowance, dan reasoning.
- [ ] Data unknown/stale dibedakan dari nol dan memiliki sumber/timestamp.
- [ ] Chain dan kontrak diverifikasi; asset mismatch maupun verifikasi pending memblok deposit.
- [ ] Exact approval teruji; allowance cukup melewati approve; approval sukses + deposit gagal tidak menghasilkan posisi palsu.
- [ ] Amount/decimals, deposit preview, partial withdrawal, MAX redeem, dan kapasitas aktual teruji terhadap vault yang dituju.
- [ ] Rejected request, RPC gagal, account/chain change, revert, replacement/timeout, dan duplicate submission ditangani.
- [ ] Receipt sukses menjadi dasar update activity dan posisi; pending tetap dapat direkonsiliasi setelah reload.
- [ ] Portfolio cocok dengan shares/asset conversion onchain; profit tidak diklaim lengkap ketika histori parsial.
- [ ] State connected tanpa posisi, posisi eksternal, dan beberapa vault semuanya teruji.

Gunakan unit test untuk formula, angka/decimals, dan state transaksi; integration test dengan RPC fork atau lingkungan uji yang mewakili kontrak target; serta visual QA pada viewport di atas. Pengujian transaksi mainnet dilakukan oleh tim dengan wallet uji dan nominal yang disetujui sebelum production launch. Jangan menyatakan mainnet transaction flow sudah tervalidasi berdasarkan screenshot atau dokumentasi saja.

**Definition of done:** pengguna dapat membuka VATE, memahami perbandingan vault dari data nyata, menghubungkan wallet, menempatkan USDG ke vault pilihan, melihat posisi, dan menariknya sesuai kapasitas vault—dengan pengalaman TOAA yang direplikasi dan identitas VATE yang lebih terang.
