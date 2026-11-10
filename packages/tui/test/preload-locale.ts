// The suite compares the console's words in Russian, the product's default language. Since the
// console follows the system language (#713), a host with LANG=en_US turned 72 tests red: the
// suite pins its own language before any module reads it. A test that needs English adopts it
// itself (phone-confirm).
process.env.LANGUAGE = "ru"
