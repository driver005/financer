# Screens and flows (Stitch)

The shopping assistant's screens as designed in the Stitch project "Shopping Assistant" (design system "HeroUI"),
each with the screen of the app it belongs to. "exists" means the app already has that screen and the design is what
to compare it with; "responsive" and "dark" are the same screen in another layout or theme.

Notes on reading the designs:
- Stitch draws sections inside white cards and search fields in grey; the app draws plain sections and a white search field. Decide per screen.
- Some screens in the Stitch designs show invented sample data (scores like 9.4, colour names); the app's real data wins.
- The category editor's header in Stitch says "Category editor"; the app shows the category's name.

## 1. Setup and settings

| Screen | App | Kind | Stitch screen id |
| --- | --- | --- | --- |
| Set it up (first start) | Setup | exists | `9c8f31b116464bee9c57d4e77fdd8215` |
| Settings, server mode | More tab / SettingsScreen | exists | `9f157224dd104745b961f2d696219695` |
| Settings, this phone | SettingsScreen (phone) | exists | `37c2bfdd7e79413c958bc786267aebb5` |
| Settings on a laptop | SettingsScreen, expanded | responsive | `151678340e494bf29df12cada7c7afe6` |
| Settings, dark | SettingsScreen, dark | dark | `a14a8db64d83418e898bff8d48511c9f` |

## 2. Searching

| Screen | App | Kind | Stitch screen id |
| --- | --- | --- | --- |
| Search home with examples | SearchScreen, no response | exists | `1635f54b81bf43f08c3213023b0febaa` |
| Indexing progress and refresh | SearchScreen, indexing | exists | `1312ee1353ac4df4a6161915131c042a` |
| No shops, nothing matches, error | SearchScreen states | exists | `9ae89a8924d04c0c83e25c6a515c3499` |
| Results (phone) | SearchScreen | exists | `587b43ac3e674e7bb400befe758f8453` |
| Results, two selected + compare bar | SearchScreen footer | exists | `c82bc131545f4788aeb08a17139fceb6` |
| Sort sheet | FilterBar sort | exists | `4043dba2f33249d8818ffb173e904205` |
| Results (tablet) | SearchScreen, medium | responsive | `380365e6bfec47a28298a9e19ad8d199` |
| Results (laptop) | SearchScreen, expanded | responsive | `6dda1665f8a444b4a532d0a8978f303b` |
| Results, dark | SearchScreen, dark | dark | `7199643c4c0842caa3be27bae79be866` |
| Notifications: progress and deal | host notifications | exists | `4ae61f48babc42dc820f22607fe075c3` |

## 3. Product and compare

| Screen | App | Kind | Stitch screen id |
| --- | --- | --- | --- |
| Product (top) | ProductScreen | exists | `5e3fc81d8de546668457ddde57cd7d11` |
| Product (offers, history, add a spec) | ProductScreen | exists | `b6a3a58617d64415b0b738bd9bb4ad12` |
| Product (tablet) | ProductScreen, medium | responsive | `07906e00d4f2492abddfe7e47a851a4e` |
| Product (laptop) | ProductScreen, expanded | responsive | `6364bf949de44386b9b83d5856b35fee` |
| Product, dark | ProductScreen, dark | dark | `5075ffa823f14f2faeeffb88123b702d` |
| Compare (phone) | CompareScreen | exists | `31cf1eb96db14e0c84f4c69bbfef70ca` |
| Compare (tablet) | CompareScreen, medium | responsive | `a1cce20955284a0787ab64cd36819606` |
| Compare (laptop) | CompareScreen, expanded | responsive | `54b24c2dfc834cd890267e9d36d6c45f` |
| Compare, dark | CompareScreen, dark | dark | `be86172f9b394c90917c222064e4dea1` |

## 4. Weights

| Screen | App | Kind | Stitch screen id |
| --- | --- | --- | --- |
| What matters to me (top) | WeightsScreen | exists | `e62ed81eb5624bef8c472be3ef9a2617` |
| What matters to me (criteria levels) | WeightsScreen | exists | `e0a0900207054b1796e6799bbde48aa3` |

## 5. Deals and watching

| Screen | App | Kind | Stitch screen id |
| --- | --- | --- | --- |
| Deals | DealsScreen | exists | `ea1f3c34fb334819943571adf033ab74` |
| Deals with messages | DealsScreen | exists | `c836bd1e228c400d8346802372ac8024` |
| Deals (laptop) | DealsScreen, expanded | responsive | `d4ae7fa29f4b4b1fb0b1dde1e6e8db8d` |
| Deals, dark | DealsScreen, dark | dark | `8ba2e2543bc34271a9fea75c404a9c6a` |
| Watching, empty | WatchesScreen | exists | `90f936d326ed4c66b805c4aa7111025c` |
| Watching, list | WatchesScreen | exists | `2b782ab371ee48db83b119c684cc3aed` |
| New watch | NewWatchScreen | exists | `526cb06307374f88b31d0ef841b5b99c` |

## 6. Plans

| Screen | App | Kind | Stitch screen id |
| --- | --- | --- | --- |
| Subscriptions | PlansScreen | exists | `6c45ca5334c746fd98f1bc32b675c6a2` |
| No subscription categories | PlansScreen, empty | exists | `382b3081a5944705bbd5781f42426a2d` |

## 7. Shops and categories

| Screen | App | Kind | Stitch screen id |
| --- | --- | --- | --- |
| Shops to read, server | SourcesScreen | exists | `1a53ae6d403c45598572c0045251b3d1` |
| Shops to read, phone | SourcesScreen | exists | `bb10817ef9db4e858a9d2ab59a88eb10` |
| Categories | CategoriesScreen | exists | `bada1ca513a44f22845e8dec6dc5b2fb` |
| Category editor | CategoryEditorScreen | exists | `ed20a52b93594e929cb0b5a0a21303a5` |
| Category editor, add attribute and criterion | CategoryEditorScreen | exists | `589ae0e299bc4b4ab6c8113f3e45a0d3` |

Project id: `12266519070521644318`; design system asset: `assets/945437121770425370`. Older explorations in the same project (sticker, clay, pop art, arcade, paper, bento, Material, iOS, editorial) are not used.
