# Screens and flows (Stitch)

Every screen of the shopping assistant as designed in the Stitch project "Shopping Assistant" (design system "HeroUI"),
with the app screen it belongs to. ✓ = designed, – = not designed (the screen is a single centred column or a transient
state, so it reuses the layout and colours of its neighbours). Phone is 390 px, tablet 820 px, laptop 1280 px.

| Screen | App | Phone | Tablet | Laptop | Dark |
| --- | --- | --- | --- | --- | --- |
| Set it up (first start) | Setup | ✓ 1 | ✓ | ✓ | ✓ |
| Settings (server / this phone) | SettingsScreen | ✓ 2 | ✓ | ✓ | ✓ |
| Search home with examples | SearchScreen | ✓ 1 | ✓ | ✓ | ✓ |
| Search results | SearchScreen | ✓ 2 | ✓ | ✓ | ✓ |
| Results with compare bar | SearchScreen | ✓ 1 | – | – | – |
| Sort sheet | FilterBar | ✓ 1 | – | – | – |
| Indexing progress | SearchScreen | ✓ 1 | – | – | – |
| No shops, nothing matches, error | SearchScreen | ✓ 1 | – | – | – |
| Product | ProductScreen | ✓ 2 | ✓ | ✓ | ✓ |
| Product, subscription plan | ProductScreen | ✓ 1 | – | – | – |
| Compare | CompareScreen | ✓ 1 | ✓ | ✓ | ✓ |
| What matters to me | WeightsScreen | ✓ 2 | ✓ | ✓ | ✓ |
| Deals (and messages) | DealsScreen | ✓ 2 | ✓ | ✓ | ✓ |
| Watching (empty, list) | WatchesScreen | ✓ 2 | ✓ | ✓ | ✓ |
| New watch | NewWatchScreen | ✓ 1 | ✓ | ✓ | ✓ |
| Subscriptions (and empty) | PlansScreen | ✓ 2 | ✓ | ✓ | ✓ |
| Shops to read (server / phone) | SourcesScreen | ✓ 2 | ✓ | ✓ | ✓ |
| Categories | CategoriesScreen | ✓ 1 | ✓ | ✓ | ✓ |
| Category editor (measured, add, aliases, JSON) | CategoryEditorScreen | ✓ 4 | ✓ | ✓ | ✓ |
| Notifications (progress, deal) | host notifications | ✓ 1 | – | – | – |
| Loading states | Starting, Comparing, results | ✓ 1 | – | – | – |
| Error and offline states | banners, empty states | ✓ 1 | – | – | – |

That is 75 screens in the matrix, plus earlier iterations of the same screens in the project.

Not designed on purpose: dark versions of the transient states (progress, sort sheet, notifications, loading, errors); tablet and laptop versions of the same states.

## Notes on reading the designs

- Stitch draws sections inside white cards and search fields in grey; the app draws plain sections and a white search field. Decide per screen.
- Some screens show invented sample data (scores like 9.4, colour names, an eye icon for Watching on the laptop); the app's real data and icons win.
- The category editor's header in Stitch says "Category editor"; the app shows the category's name.

## Stitch screen ids

Project `12266519070521644318`, design system `assets/945437121770425370`.

| Screen | Id |
| --- | --- |
| Set it up (first start) (phone) | `9c8f31b116464bee9c57d4e77fdd8215` |
| Set it up (first start) (tablet) | `84061117fa714b6eb81e67b4236a09c9` |
| Set it up (first start) (laptop) | `2ea4685e0f8946d4bdc55b572d571962` |
| Set it up (first start) (dark) | `ef2918752078462ea7e0c06155d8e7ef` |
| Settings (server / this phone) (phone) | `9f157224dd104745b961f2d696219695` |
| Settings (server / this phone) (phone) | `37c2bfdd7e79413c958bc786267aebb5` |
| Settings (server / this phone) (tablet) | `ae3765f2da474c6fa87ea74ff635b86d` |
| Settings (server / this phone) (laptop) | `151678340e494bf29df12cada7c7afe6` |
| Settings (server / this phone) (dark) | `a14a8db64d83418e898bff8d48511c9f` |
| Search home with examples (phone) | `1635f54b81bf43f08c3213023b0febaa` |
| Search home with examples (tablet) | `5cc171a363c34632865449ce0bb40f13` |
| Search home with examples (laptop) | `46658024753a48ef9bd0d5f4871073a5` |
| Search home with examples (dark) | `a6aaadf494494b829ede44e1cfc709c2` |
| Search results (phone) | `587b43ac3e674e7bb400befe758f8453` |
| Search results (phone) | `892dbb7675e84579992d5a156bc1dadd` |
| Search results (tablet) | `380365e6bfec47a28298a9e19ad8d199` |
| Search results (laptop) | `6dda1665f8a444b4a532d0a8978f303b` |
| Search results (dark) | `7199643c4c0842caa3be27bae79be866` |
| Results with compare bar (phone) | `c82bc131545f4788aeb08a17139fceb6` |
| Sort sheet (phone) | `4043dba2f33249d8818ffb173e904205` |
| Indexing progress (phone) | `1312ee1353ac4df4a6161915131c042a` |
| No shops, nothing matches, error (phone) | `9ae89a8924d04c0c83e25c6a515c3499` |
| Product (phone) | `5e3fc81d8de546668457ddde57cd7d11` |
| Product (phone) | `b6a3a58617d64415b0b738bd9bb4ad12` |
| Product (tablet) | `07906e00d4f2492abddfe7e47a851a4e` |
| Product (laptop) | `6364bf949de44386b9b83d5856b35fee` |
| Product (dark) | `5075ffa823f14f2faeeffb88123b702d` |
| Product, subscription plan (phone) | `0e4d332c606d4cc0aaccf31b5decbd2b` |
| Compare (phone) | `31cf1eb96db14e0c84f4c69bbfef70ca` |
| Compare (tablet) | `a1cce20955284a0787ab64cd36819606` |
| Compare (laptop) | `54b24c2dfc834cd890267e9d36d6c45f` |
| Compare (dark) | `be86172f9b394c90917c222064e4dea1` |
| What matters to me (phone) | `e62ed81eb5624bef8c472be3ef9a2617` |
| What matters to me (phone) | `e0a0900207054b1796e6799bbde48aa3` |
| What matters to me (tablet) | `638b5378d0b74a47a2916fb40c0aa263` |
| What matters to me (laptop) | `84a89b420286495c8226503862687877` |
| What matters to me (dark) | `ca2a4587334242b8ab2af0a6e07cd70a` |
| Deals (and messages) (phone) | `ea1f3c34fb334819943571adf033ab74` |
| Deals (and messages) (phone) | `c836bd1e228c400d8346802372ac8024` |
| Deals (and messages) (tablet) | `58a60f0c3b07476c985f28bed002a99f` |
| Deals (and messages) (laptop) | `d4ae7fa29f4b4b1fb0b1dde1e6e8db8d` |
| Deals (and messages) (dark) | `8ba2e2543bc34271a9fea75c404a9c6a` |
| Watching (empty, list) (phone) | `90f936d326ed4c66b805c4aa7111025c` |
| Watching (empty, list) (phone) | `2b782ab371ee48db83b119c684cc3aed` |
| Watching (empty, list) (tablet) | `f952eba3242443a4a668ccf9bcc2e210` |
| Watching (empty, list) (laptop) | `dac5aa21e7164368b967514a287c07da` |
| Watching (empty, list) (dark) | `55982b5c6f584cba8efa40a14019cf7f` |
| New watch (phone) | `526cb06307374f88b31d0ef841b5b99c` |
| New watch (tablet) | `00be896c5947484184e50ddc880d387b` |
| New watch (laptop) | `8fce5bbf265b44a7b5628df3a7588a5e` |
| New watch (dark) | `cb7ee29f41344e128edda06dd6fefac7` |
| Subscriptions (and empty) (phone) | `6c45ca5334c746fd98f1bc32b675c6a2` |
| Subscriptions (and empty) (phone) | `382b3081a5944705bbd5781f42426a2d` |
| Subscriptions (and empty) (tablet) | `460e61b347224c6cbeffeccdc0093fcf` |
| Subscriptions (and empty) (laptop) | `4623ce69974948a6aa5d0a223b6b3269` |
| Subscriptions (and empty) (dark) | `4f49a848905f42e889f65ba73a753da0` |
| Shops to read (server / phone) (phone) | `1a53ae6d403c45598572c0045251b3d1` |
| Shops to read (server / phone) (phone) | `bb10817ef9db4e858a9d2ab59a88eb10` |
| Shops to read (server / phone) (tablet) | `b253821ae0694695b9cd251bf0194a84` |
| Shops to read (server / phone) (laptop) | `26c60c02e0cd448c90263cfeca384fea` |
| Shops to read (server / phone) (dark) | `88aa0e3bb88549238023efc99b0a367c` |
| Categories (phone) | `bada1ca513a44f22845e8dec6dc5b2fb` |
| Categories (tablet) | `c6b047c1c34447c485c2cbeec7d0d1bb` |
| Categories (laptop) | `329ad66a5d86457bbb570330585722f4` |
| Categories (dark) | `1c8955bdf5d545b4b6c65b0e9f7228c3` |
| Category editor (measured, add, aliases, JSON) (phone) | `ed20a52b93594e929cb0b5a0a21303a5` |
| Category editor (measured, add, aliases, JSON) (phone) | `589ae0e299bc4b4ab6c8113f3e45a0d3` |
| Category editor (measured, add, aliases, JSON) (phone) | `245b8797470849cbb34a43d5d4c5be07` |
| Category editor (measured, add, aliases, JSON) (phone) | `af753fcaac23421b9fa64fc050f5b73a` |
| Category editor (measured, add, aliases, JSON) (tablet) | `aa2ad4b46e1f4cffa59f7eb9fda7701d` |
| Category editor (measured, add, aliases, JSON) (laptop) | `d53b2f60802e454b843aafb480a18a8b` |
| Category editor (measured, add, aliases, JSON) (dark) | `c1197c81e0bf465cae8365c3ec994c34` |
| Notifications (progress, deal) (phone) | `4ae61f48babc42dc820f22607fe075c3` |
| Loading states (phone) | `4b7c53bf8197406280dc5b653cb7b5ea` |
| Error and offline states (phone) | `a8e9089da8c64a37849ee1fdc70b9d4c` |
