#include <windows.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Security.Credentials.UI.h>
#include <UserConsentVerifierInterop.h>
#include <iostream>
#include <string>
#include <cwctype>
using namespace winrt;
using namespace Windows::Security::Credentials::UI;
int wmain(int argc, wchar_t** argv) {
  try {
    init_apartment(apartment_type::multi_threaded);
    if (argc == 2 && std::wstring(argv[1]) == L"check") {
      std::cout << (UserConsentVerifier::CheckAvailabilityAsync().get() ==
        UserConsentVerifierAvailability::Available ? "available" : "unavailable");
      return 0;
    }
    if (argc != 5 || std::wstring(argv[1]) != L"verify") return 2;
    std::wstring challenge(argv[4]);
    if (challenge.size() != 64) return 2;
    for (auto c : challenge) if (!iswxdigit(c)) return 2;
    HWND owner = reinterpret_cast<HWND>(std::stoull(argv[2], nullptr, 16));
    DWORD pid = 0;
    if (!IsWindow(owner) || !GetWindowThreadProcessId(owner, &pid) || pid != std::stoul(argv[3])) return 2;
    auto interop = get_activation_factory<UserConsentVerifier, IUserConsentVerifierInterop>();
    Windows::Foundation::IAsyncOperation<UserConsentVerificationResult> operation{nullptr};
    hstring reason(L"Unlock your Thread vault");
    check_hresult(interop->RequestVerificationForWindowAsync(owner, static_cast<HSTRING>(get_abi(reason)),
      guid_of<decltype(operation)>(), put_abi(operation)));
    auto result = operation.get();
    std::wcout << (result == UserConsentVerificationResult::Verified ? L"verified:" : L"denied:") << challenge;
    return 0;
  } catch (...) { std::cout << "unavailable"; return 1; }
}
