"""A software WebAuthn authenticator for the tests: it is not the code under test.

Made with `cryptography` and `cbor2`; `selfcheck` also runs its output through Yubico's `fido2`
server code, so a mistake of this script cannot pass as a feature of the C++ side.

  authenticator.py STATE new ALG                      ALG: es256, rs256, ed25519
  authenticator.py STATE register RP ORIGIN CHALLENGE [flags]
  authenticator.py STATE get RP ORIGIN CHALLENGE [flags]
  authenticator.py selfcheck ALG

Flags: --no-uv, --no-up, --origin X, --rp X (hash another relying party), --type T,
       --corrupt-sig, --counter N, --fmt F, --cross-origin, --other-id, --extensions
"""
import base64
import hashlib
import json
import os
import struct
import sys

import cbor2
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, ed25519, padding, rsa


def b64u(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def unb64u(text):
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def int_bytes(number):
    return number.to_bytes((number.bit_length() + 7) // 8 or 1, "big")


class Authenticator:
    def __init__(self, algorithm, key=None, credential_id=None, counter=0):
        self.algorithm = algorithm
        if key is None:
            if algorithm == "es256":
                key = ec.generate_private_key(ec.SECP256R1())
            elif algorithm == "rs256":
                key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
            else:
                key = ed25519.Ed25519PrivateKey.generate()
        self.key = key
        self.credential_id = credential_id or os.urandom(32)
        self.counter = counter

    @classmethod
    def load(cls, path):
        state = json.load(open(path))
        key = serialization.load_pem_private_key(state["key"].encode(), None)
        return cls(state["algorithm"], key, unb64u(state["credential_id"]), state["counter"])

    def save(self, path):
        pem = self.key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        ).decode()
        json.dump(
            {
                "algorithm": self.algorithm,
                "key": pem,
                "credential_id": b64u(self.credential_id),
                "counter": self.counter,
            },
            open(path, "w"),
        )

    def cose_key(self):
        public = self.key.public_key()
        if self.algorithm == "es256":
            numbers = public.public_numbers()
            return cbor2.dumps(
                {1: 2, 3: -7, -1: 1, -2: numbers.x.to_bytes(32, "big"), -3: numbers.y.to_bytes(32, "big")}
            )
        if self.algorithm == "rs256":
            numbers = public.public_numbers()
            return cbor2.dumps({1: 3, 3: -257, -1: int_bytes(numbers.n), -2: int_bytes(numbers.e)})
        raw = public.public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
        return cbor2.dumps({1: 1, 3: -8, -1: 6, -2: raw})

    def sign(self, data):
        if self.algorithm == "es256":
            return self.key.sign(data, ec.ECDSA(hashes.SHA256()))
        if self.algorithm == "rs256":
            return self.key.sign(data, padding.PKCS1v15(), hashes.SHA256())
        return self.key.sign(data)

    def client_data(self, kind, challenge, origin, flags):
        data = {"type": kind, "challenge": b64u(challenge), "origin": flags["origin"] or origin}
        if flags["cross_origin"]:
            data["crossOrigin"] = True
        if flags["type"]:
            data["type"] = flags["type"]
        return json.dumps(data, separators=(",", ":")).encode()

    @staticmethod
    def flag_byte(flags, attested):
        value = 0
        if not flags["no_up"]:
            value |= 0x01
        if not flags["no_uv"]:
            value |= 0x04
        if attested:
            value |= 0x40
        if flags["extensions"]:
            value |= 0x80
        return value

    def register(self, rp_id, origin, challenge, flags):
        rp_hash = hashlib.sha256((flags["rp"] or rp_id).encode()).digest()
        credential_id = os.urandom(32) if flags["other_id"] else self.credential_id
        data = (
            rp_hash
            + bytes([self.flag_byte(flags, True)])
            + struct.pack(">I", self.counter)
            + bytes(16)
            + struct.pack(">H", len(credential_id))
            + credential_id
            + self.cose_key()
        )
        if flags["extensions"]:
            data += cbor2.dumps({"credProps": {"rk": True}})
        attestation = cbor2.dumps({"fmt": flags["fmt"] or "none", "attStmt": {}, "authData": data})
        client = self.client_data("webauthn.create", challenge, origin, flags)
        return {
            "id": b64u(self.credential_id),
            "rawId": b64u(self.credential_id),
            "type": "public-key",
            "response": {"clientDataJSON": b64u(client), "attestationObject": b64u(attestation)},
        }

    def get(self, rp_id, origin, challenge, flags):
        if flags["counter"] is not None:
            self.counter = flags["counter"]
        else:
            self.counter += 1
        rp_hash = hashlib.sha256((flags["rp"] or rp_id).encode()).digest()
        data = rp_hash + bytes([self.flag_byte(flags, False)]) + struct.pack(">I", self.counter)
        client = self.client_data("webauthn.get", challenge, origin, flags)
        signature = self.sign(data + hashlib.sha256(client).digest())
        if flags["corrupt_sig"]:
            signature = bytearray(signature)
            signature[-1] ^= 1
            signature = bytes(signature)
        return {
            "id": b64u(self.credential_id),
            "rawId": b64u(self.credential_id),
            "type": "public-key",
            "response": {
                "clientDataJSON": b64u(client),
                "authenticatorData": b64u(data),
                "signature": b64u(signature),
            },
        }


def parse_flags(args):
    flags = {
        "no_uv": False, "no_up": False, "origin": None, "rp": None, "type": None,
        "corrupt_sig": False, "counter": None, "fmt": None, "cross_origin": False,
        "other_id": False, "extensions": False,
    }
    index = 0
    while index < len(args):
        name = args[index]
        if name in ("--no-uv", "--no-up", "--corrupt-sig", "--cross-origin", "--other-id", "--extensions"):
            flags[name[2:].replace("-", "_")] = True
        elif name in ("--origin", "--rp", "--type", "--fmt"):
            index += 1
            flags[name[2:]] = args[index]
        elif name == "--counter":
            index += 1
            flags["counter"] = int(args[index])
        else:
            raise SystemExit("unknown flag " + name)
        index += 1
    return flags


def selfcheck(algorithm):
    """Verify what the authenticator makes with Yubico's server code."""
    from fido2.server import Fido2Server
    from fido2.webauthn import PublicKeyCredentialRpEntity

    rp, origin = "example.test", "https://example.test"
    server = Fido2Server(PublicKeyCredentialRpEntity(id=rp, name="test"), verify_origin=lambda o: o == origin)
    authenticator = Authenticator(algorithm)
    flags = parse_flags([])
    challenge = os.urandom(32)
    state = {"challenge": b64u(challenge), "user_verification": None}
    auth_data = server.register_complete(state, authenticator.register(rp, origin, challenge, flags))
    challenge = os.urandom(32)
    state = {"challenge": b64u(challenge), "user_verification": None}
    server.authenticate_complete(
        state, [auth_data.credential_data], authenticator.get(rp, origin, challenge, flags)
    )
    print("fido2 accepted", algorithm)


def main():
    if sys.argv[1] == "selfcheck":
        selfcheck(sys.argv[2])
        return
    state_path, command = sys.argv[1], sys.argv[2]
    if command == "new":
        Authenticator(sys.argv[3]).save(state_path)
        return
    authenticator = Authenticator.load(state_path)
    rp, origin, challenge = sys.argv[3], sys.argv[4], unb64u(sys.argv[5])
    flags = parse_flags(sys.argv[6:])
    if command == "register":
        out = authenticator.register(rp, origin, challenge, flags)
    else:
        out = authenticator.get(rp, origin, challenge, flags)
    authenticator.save(state_path)
    print(json.dumps(out))


main()
