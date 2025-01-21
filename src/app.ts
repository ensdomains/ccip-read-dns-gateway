import { DNSProver } from '@ensdomains/dnsprovejs';
import { ethers } from 'ethers';
import * as packet from 'dns-packet';
import * as qTypes from 'dns-packet/types';
import { serializeError } from './utils';

export function makeApp(
  sendQuery: ConstructorParameters<typeof DNSProver>[0],
  path: string,
  Server: any,
  trackEvent?: Function
) {
  const prover = new DNSProver(sendQuery);
  const emptyRRSet = [
    [
      {
        rrset: [],
        sig: [],
      },
    ],
  ];

  const server = new Server();
  const abi = [
    'function resolve(bytes name, uint16 qtype) returns(tuple(bytes rrset, bytes sig)[])',
  ];
  server.add(abi, [
    {
      type: 'resolve',
      func: async (args: ethers.utils.Result) => {
        const [name, qtype] = args;
        const decodedName = (packet as any).name.decode(
          Buffer.from(name.slice(2), 'hex')
        );

        if (
          decodedName.split('.').length < 2 ||
          decodedName.startsWith('.') ||
          decodedName.endsWith('.')
        ) {
          return emptyRRSet;
        }

        if (trackEvent) {
          setTimeout(() => {
            trackEvent(
              'resolve',
              {
                props: { name: decodedName, qtype: qTypes.toString(qtype) },
              },
              true
            ).catch(console.error);
          }, 0);
        }

        try {
          const result = await prover.queryWithProof(
            qTypes.toString(qtype),
            decodedName
          );
          if (!result) {
            return emptyRRSet;
          }
          const ret = Array.prototype
            .concat(result.proofs, [result.answer])
            .map(entry => ({
              rrset: entry.toWire(),
              sig: entry.signature.data.signature,
            }));
          return [ret];
        } catch (error) {
          if (trackEvent) {
            setTimeout(() => {
              trackEvent(
                'error',
                {
                  props: { name: decodedName, message: serializeError(error) },
                },
                true
              ).catch(console.error);
            }, 0);
          }

          return emptyRRSet;
        }
      },
    },
  ]);
  return server.makeApp(path);
}
