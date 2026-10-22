// Прокси и свой сертификат из настроек (#461): что проверяется и какие переменные получают окно и служба.
import { describe, expect, test } from "bun:test"
import { BuffNetwork } from "./network"

describe("the proxy address", () => {
  test("an http(s) address with a host is fine", () => {
    expect(BuffNetwork.proxyProblem("http://proxy.corp:3128")).toBeUndefined()
    expect(BuffNetwork.proxyProblem("https://proxy.corp")).toBeUndefined()
    expect(BuffNetwork.proxyProblem("")).toBeUndefined()
  })
  test("anything else says what is wrong", () => {
    expect(BuffNetwork.proxyProblem("proxy.corp:3128")).toBe(
      "The proxy address starts with http:// or https://, for example http://proxy.company.local:3128.",
    )
    expect(BuffNetwork.proxyProblem("socks5://proxy:1080")).toBe(
      "An HTTP proxy is supported: an address with http:// or https://.",
    )
    expect(BuffNetwork.proxyProblem("http://user:pass@proxy:3128")).toBe(
      "The login and password go in separate fields, not in the address.",
    )
  })
})

describe("what the app and its service get", () => {
  test("nothing set — nothing changes: the system's proxy stays", () => {
    expect(BuffNetwork.environment({ proxy: "", noProxy: "", caFile: "", username: "" }, undefined)).toEqual({})
  })
  test("the proxy for both schemes, exceptions, the certificate", () => {
    expect(
      BuffNetwork.environment(
        {
          proxy: "http://proxy.corp:3128",
          noProxy: " *.corp, 10.0.0.0/8 ,,",
          caFile: "/etc/corp-ca.pem",
          username: "",
        },
        undefined,
      ),
    ).toEqual({
      HTTP_PROXY: "http://proxy.corp:3128/",
      HTTPS_PROXY: "http://proxy.corp:3128/",
      http_proxy: "http://proxy.corp:3128/",
      https_proxy: "http://proxy.corp:3128/",
      NO_PROXY: "*.corp,10.0.0.0/8",
      no_proxy: "*.corp,10.0.0.0/8",
      NODE_EXTRA_CA_CERTS: "/etc/corp-ca.pem",
    })
  })
  test("login and password go into the address the service uses, escaped", () => {
    expect(
      BuffNetwork.environment(
        { proxy: "http://proxy.corp:3128", noProxy: "", caFile: "", username: "ivan@corp" },
        "p@ss:word",
      ).HTTPS_PROXY,
    ).toBe("http://ivan%40corp:p%40ss%3Aword@proxy.corp:3128/")
  })
  test("the window's proxy rule is host and port, without credentials", () => {
    expect(BuffNetwork.chromiumRule("http://proxy.corp:3128")).toBe("http=proxy.corp:3128;https=proxy.corp:3128")
    expect(BuffNetwork.chromiumRule("https://proxy.corp")).toBe("http=proxy.corp:443;https=proxy.corp:443")
  })
})
