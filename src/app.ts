import { DNSProver } from '@ensdomains/dnsprovejs';
import { ethers } from 'ethers';
import * as packet from 'dns-packet';
import * as qTypes from 'dns-packet/types';

export function makeApp(
  sendQuery: ConstructorParameters<typeof DNSProver>[0],
  path: string,
  Server: any
) {
  const prover = new DNSProver(sendQuery);

  const server = new Server();
  const abi = [
    'function resolve(bytes name, uint16 qtype) returns(tuple(bytes rrset, bytes sig)[])',
  ];
  server.add(abi, [
    {
      type: 'resolve',
      func: async (args: ethers.utils.Result) => {
        const [name, qtype] = args;
        const decodedName = packet.name.decode(
          Buffer.from(name.slice(2), 'hex')
        );
        const result = await prover.queryWithProof(qTypes.toString(qtype), decodedName);
        const ret = Array.prototype
          .concat(result.proofs, [result.answer])
          .map(entry => ({
            rrset: entry.toWire(),
            sig: entry.signature.data.signature,
          }));
        return [ret];
      },
    },
  ]);
  return server.makeApp(path);
}
