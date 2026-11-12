import type { JournalSubscription, PresetPackId } from './types';

export interface JournalPresetPack {
  id: PresetPackId;
  journals: JournalSubscription[];
}

export const JOURNAL_PRESET_PACKS: readonly JournalPresetPack[] = [
  {
    id: 'top',
    journals: [
      {
        issn: '0028-0836',
        title: 'Nature',
        publisher: 'Springer Nature',
        altIssns: ['0028-0836', '1476-4687'],
      },
      {
        issn: '0036-8075',
        title: 'Science',
        publisher: 'AAAS',
        altIssns: ['0036-8075', '1095-9203'],
      },
      {
        issn: '0092-8674',
        title: 'Cell',
        publisher: 'Elsevier',
        altIssns: ['0092-8674', '1097-4172'],
      },
    ],
  },
  {
    id: 'aps',
    journals: [
      {
        issn: '0031-9007',
        title: 'Physical Review Letters',
        publisher: 'American Physical Society (APS)',
        altIssns: ['0031-9007', '1079-7114'],
      },
      {
        issn: '2469-9950',
        title: 'Physical Review B',
        publisher: 'American Physical Society (APS)',
        altIssns: ['2469-9950', '2469-9969'],
      },
      {
        issn: '2160-3308',
        title: 'Physical Review X',
        publisher: 'American Physical Society (APS)',
        altIssns: ['2160-3308'],
      },
      {
        issn: '0034-6861',
        title: 'Reviews of Modern Physics',
        publisher: 'American Physical Society (APS)',
        altIssns: ['0034-6861', '1539-0756'],
      },
      {
        issn: '2331-7019',
        title: 'Physical Review Applied',
        publisher: 'American Physical Society (APS)',
        altIssns: ['2331-7019'],
      },
      {
        issn: '2691-3399',
        title: 'PRX Quantum',
        publisher: 'American Physical Society (APS)',
        altIssns: ['2691-3399'],
      },
    ],
  },
  {
    id: 'acs',
    journals: [
      {
        issn: '0002-7863',
        title: 'Journal of the American Chemical Society',
        publisher: 'American Chemical Society (ACS)',
        altIssns: ['0002-7863', '1520-5126'],
      },
      {
        issn: '1936-0851',
        title: 'ACS Nano',
        publisher: 'American Chemical Society (ACS)',
        altIssns: ['1936-0851', '1936-086X'],
      },
      {
        issn: '1530-6984',
        title: 'Nano Letters',
        publisher: 'American Chemical Society (ACS)',
        altIssns: ['1530-6984', '1530-6992'],
      },
      {
        issn: '2470-1343',
        title: 'ACS Central Science',
        publisher: 'American Chemical Society (ACS)',
        altIssns: ['2470-1343'],
      },
      {
        issn: '2155-5435',
        title: 'ACS Catalysis',
        publisher: 'American Chemical Society (ACS)',
        altIssns: ['2155-5435'],
      },
      {
        issn: '1948-7185',
        title: 'Journal of Physical Chemistry Letters',
        publisher: 'American Chemical Society (ACS)',
        altIssns: ['1948-7185'],
      },
    ],
  },
  {
    id: 'wiley',
    journals: [
      {
        issn: '0935-9648',
        title: 'Advanced Materials',
        publisher: 'Wiley',
        altIssns: ['0935-9648', '1521-4095'],
      },
      {
        issn: '1433-7851',
        title: 'Angewandte Chemie International Edition',
        publisher: 'Wiley',
        altIssns: ['1433-7851', '1521-3773'],
      },
      {
        issn: '1616-301X',
        title: 'Advanced Functional Materials',
        publisher: 'Wiley',
        altIssns: ['1616-301X', '1616-3028'],
      },
      {
        issn: '1614-6832',
        title: 'Advanced Energy Materials',
        publisher: 'Wiley',
        altIssns: ['1614-6832', '1614-6840'],
      },
      {
        issn: '1613-6810',
        title: 'Small',
        publisher: 'Wiley',
        altIssns: ['1613-6810', '1613-6829'],
      },
    ],
  },
  {
    id: 'springer',
    journals: [
      {
        issn: '2041-1723',
        title: 'Nature Communications',
        publisher: 'Springer Nature',
        altIssns: ['2041-1723'],
      },
      {
        issn: '1745-2473',
        title: 'Nature Physics',
        publisher: 'Springer Nature',
        altIssns: ['1745-2473', '1745-2481'],
      },
      {
        issn: '1748-3387',
        title: 'Nature Nanotechnology',
        publisher: 'Springer Nature',
        altIssns: ['1748-3387', '1748-3395'],
      },
      {
        issn: '1476-1122',
        title: 'Nature Materials',
        publisher: 'Springer Nature',
        altIssns: ['1476-1122', '1476-4660'],
      },
      {
        issn: '1749-4885',
        title: 'Nature Photonics',
        publisher: 'Springer Nature',
        altIssns: ['1749-4885', '1749-4893'],
      },
      {
        issn: '0010-3616',
        title: 'Communications in Mathematical Physics',
        publisher: 'Springer Nature',
        altIssns: ['0010-3616', '1432-0916'],
      },
      {
        issn: '1434-6060',
        title: 'European Physical Journal C',
        publisher: 'Springer Nature',
        altIssns: ['1434-6060', '1434-6052'],
      },
    ],
  },
  {
    id: 'rsc',
    journals: [
      {
        issn: '0306-0012',
        title: 'Chemical Society Reviews',
        publisher: 'Royal Society of Chemistry (RSC)',
        altIssns: ['0306-0012', '1460-4744'],
      },
      {
        issn: '2041-6520',
        title: 'Chemical Science',
        publisher: 'Royal Society of Chemistry (RSC)',
        altIssns: ['2041-6520', '2041-6539'],
      },
      {
        issn: '1754-5692',
        title: 'Energy & Environmental Science',
        publisher: 'Royal Society of Chemistry (RSC)',
        altIssns: ['1754-5692', '1754-5706'],
      },
      {
        issn: '2050-7488',
        title: 'Journal of Materials Chemistry A',
        publisher: 'Royal Society of Chemistry (RSC)',
        altIssns: ['2050-7488', '2050-7496'],
      },
    ],
  },
  {
    id: 'elsevier',
    journals: [
      {
        issn: '2451-9294',
        title: 'Chem',
        publisher: 'Elsevier',
        altIssns: ['2451-9294', '2451-9308'],
      },
      {
        issn: '2542-4351',
        title: 'Joule',
        publisher: 'Elsevier',
        altIssns: ['2542-4351', '2542-4785'],
      },
      {
        issn: '2590-2385',
        title: 'Matter',
        publisher: 'Elsevier',
        altIssns: ['2590-2385'],
      },
      {
        issn: '0008-6223',
        title: 'Carbon',
        publisher: 'Elsevier',
        altIssns: ['0008-6223', '1873-3891'],
      },
      {
        issn: '2405-8297',
        title: 'Energy Storage Materials',
        publisher: 'Elsevier',
        altIssns: ['2405-8297'],
      },
    ],
  },
  {
    id: 'ieee',
    journals: [
      {
        issn: '0018-9219',
        title: 'Proceedings of the IEEE',
        publisher: 'IEEE',
        altIssns: ['0018-9219', '1558-2256'],
      },
      {
        issn: '0162-8828',
        title: 'IEEE Transactions on Pattern Analysis and Machine Intelligence',
        publisher: 'IEEE',
        altIssns: ['0162-8828', '1939-3539'],
      },
      {
        issn: '2162-237X',
        title: 'IEEE Transactions on Neural Networks and Learning Systems',
        publisher: 'IEEE',
        altIssns: ['2162-237X', '2162-2388'],
      },
    ],
  },
];
