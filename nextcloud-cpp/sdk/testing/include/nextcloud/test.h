/**
 * @file test.h
 * @brief The smallest test harness that works: a test binary is a plain `int main`, exit code 0 is a
 * pass (same convention as congelado's `congelado_cc_test`). No framework to fetch.
 */
#pragma once

#include <cstdio>
#include <sstream>
#include <string>

namespace nc::testing {

inline int& failures() noexcept
{
    static int count = 0;
    return count;
}

inline void report(const char* file, int line, const char* expression, const std::string& detail)
{
    std::fprintf(
        stderr, "%s:%d: check failed: %s %s\n", file, line, expression, detail.c_str()
    );
    ++failures();
}

template<typename Left, typename Right>
void check_equal(
    const Left& left,
    const Right& right,
    const char* file,
    int line,
    const char* expression
)
{
    if (!(left == right)) {
        std::ostringstream detail;
        detail << "(left: " << left << ", right: " << right << ")";
        report(file, line, expression, detail.str());
    }
}

}  // namespace nc::testing

#define NC_CHECK(condition)                                                                   \
    do {                                                                                      \
        if (!(condition)) {                                                                   \
            ::nc::testing::report(__FILE__, __LINE__, #condition, "");                        \
        }                                                                                     \
    } while (false)

#define NC_CHECK_EQ(left, right)                                                              \
    ::nc::testing::check_equal((left), (right), __FILE__, __LINE__, #left " == " #right)

/// Ends a test binary: prints the result and returns the exit code.
#define NC_TEST_RESULT()                                                                      \
    (::nc::testing::failures() == 0 ? (std::puts("ok"), 0)                                    \
                                    : (std::fprintf(                                          \
                                           stderr, "%d check(s) failed\n",                    \
                                           ::nc::testing::failures()                          \
                                       ),                                                     \
                                       1))
