import {
  advanceStatus,
  CHANNELS,
  Channel,
  closesCommunicationLoop,
  criticalCommunication,
  DeliveryRecord,
  deliveryKey,
  describeDelivery,
  DistributionRequest,
  isDuplicate,
  planDistribution,
  Recipient,
  supersededDeliveries,
  VERIFICATION_VALIDITY_MS,
} from './distribution';

const NOW = 1_700_000_000_000;

const recipient = (over: Partial<Recipient> = {}): Recipient => ({
  id: 'pac-1',
  name: 'Maria',
  address: 'maria@example.com',
  verified: true,
  verifiedAt: NOW - 1000,
  ...over,
});

const request = (over: Partial<DistributionRequest> = {}): DistributionRequest => ({
  reportId: 'LAU-1',
  reportVersion: 1,
  channel: 'portal',
  payload: 'report',
  recipient: recipient(),
  ...over,
});

const record = (over: Partial<DeliveryRecord> = {}): DeliveryRecord => ({
  key: 'k',
  reportId: 'LAU-1',
  reportVersion: 1,
  channel: 'email',
  payload: 'report',
  recipientId: 'pac-1',
  status: 'sent',
  attempts: 1,
  updatedAt: NOW,
  ...over,
});

describe('distribution — an unauthenticated channel may not carry the report', () => {
  it.each<[Channel]>([['email'], ['whatsapp'], ['sms']])(
    'refuses the report over %s and says where it should go',
    channel => {
      const plan = planDistribution([request({ channel, payload: 'report' })], NOW);
      expect(plan.allowed).toHaveLength(0);
      expect(plan.refused[0].reason).toMatch(/não autentica o destinatário/);
      expect(plan.refused[0].reason).toMatch(/o conteúdo pelo portal/);
    }
  );

  it('allows the notification over the same channels', () => {
    const plan = planDistribution(
      [request({ channel: 'whatsapp', payload: 'notification' })],
      NOW
    );
    expect(plan.allowed).toHaveLength(1);
  });

  // Downgrading silently would satisfy the rule and hide from the sender that the
  // recipient is not getting what they were told they would get.
  it('refuses rather than downgrading the payload', () => {
    const plan = planDistribution([request({ channel: 'email', payload: 'report' })], NOW);
    expect(plan.allowed).toHaveLength(0);
    expect(plan.refused).toHaveLength(1);
  });

  it('allows the report over the portal', () => {
    expect(planDistribution([request()], NOW).allowed).toHaveLength(1);
  });

  // Handed over against an identity check at the counter.
  it('treats a counter collection as authenticated', () => {
    expect(CHANNELS.print.authenticatesRecipient).toBe(true);
    expect(planDistribution([request({ channel: 'print' })], NOW).allowed).toHaveLength(1);
  });
});

describe('distribution — the recipient', () => {
  it('refuses an unverified contact', () => {
    const plan = planDistribution([request({ recipient: recipient({ verified: false }) })], NOW);
    expect(plan.refused[0].reason).toMatch(/enviar para o contato errado é a falha que importa/);
  });

  it('warns on a contact verified over a year ago', () => {
    const plan = planDistribution(
      [request({ recipient: recipient({ verifiedAt: NOW - VERIFICATION_VALIDITY_MS - 1 }) })],
      NOW
    );
    expect(plan.allowed[0].warnings.join(' ')).toMatch(/Números e e-mails mudam de dono/);
  });

  // A household phone is read by whoever picks it up.
  it('refuses the report to a contact marked shared', () => {
    const plan = planDistribution(
      [request({ channel: 'portal', recipient: recipient({ shared: true }) })],
      NOW
    );
    expect(plan.refused[0].reason).toMatch(/telefone de família expõe o resultado/);
  });

  it('still allows a notification to a shared contact', () => {
    const plan = planDistribution(
      [request({ channel: 'sms', payload: 'notification', recipient: recipient({ shared: true }) })],
      NOW
    );
    expect(plan.allowed).toHaveLength(1);
  });

  it('refuses an empty address, an unknown channel and a missing version', () => {
    const plan = planDistribution(
      [
        request({ recipient: recipient({ address: '' }) }),
        request({ channel: 'pigeon' as Channel }),
        request({ reportVersion: NaN }),
      ],
      NOW
    );
    expect(plan.refused).toHaveLength(3);
  });

  it('warns when a critical report goes by a channel that cannot confirm delivery', () => {
    const plan = planDistribution([request({ channel: 'print', critical: true })], NOW);
    expect(plan.allowed[0].warnings.join(' ')).toMatch(/A comunicação não se fecha por aqui/);
  });
});

describe('distribution — sent is not delivered, delivered is not read', () => {
  it('closes the loop only on read', () => {
    expect(closesCommunicationLoop(record({ status: 'sent' }))).toBe(false);
    expect(closesCommunicationLoop(record({ status: 'delivered' }))).toBe(false);
    expect(closesCommunicationLoop(record({ status: 'read' }))).toBe(true);
  });

  it('accepts an out-of-band acknowledgement', () => {
    expect(closesCommunicationLoop(record({ status: 'sent', acknowledgedBy: 'Dr. Silva por telefone' }))).toBe(true);
  });

  it('advances forward', () => {
    const result = advanceStatus(record({ status: 'sent' }), 'delivered', NOW + 1);
    expect(result.ok).toBe(true);
    expect(result.record.status).toBe('delivered');
  });

  // A late webhook must not reopen a loop that was legitimately closed.
  it('refuses to move backwards', () => {
    const result = advanceStatus(record({ status: 'read' }), 'sent', NOW + 1);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/não pode reabrir um ciclo fechado/);
  });

  it('accepts a failure at any point, and a recovery after it', () => {
    const failed = advanceStatus(record({ status: 'delivered' }), 'failed', NOW + 1, 'bounce');
    expect(failed.record.status).toBe('failed');
    const retried = advanceStatus(failed.record, 'sent', NOW + 2);
    expect(retried.record.status).toBe('sent');
    expect(retried.record.error).toBeUndefined();
  });

  it('refuses an unknown status', () => {
    expect(advanceStatus(record(), 'lido' as never, NOW).ok).toBe(false);
  });
});

describe('distribution — a retry must not become a second disclosure', () => {
  it('keys on report, version, channel, payload and recipient', () => {
    const a = deliveryKey(request());
    expect(deliveryKey(request())).toBe(a);
    expect(deliveryKey(request({ reportVersion: 2 }))).not.toBe(a);
    expect(deliveryKey(request({ payload: 'notification' }))).not.toBe(a);
  });

  // The first message may well have arrived.
  it('detects the duplicate before the adapter is called', () => {
    const key = deliveryKey(request());
    expect(isDuplicate(key, [record({ key, status: 'sent' })])).toBe(true);
  });

  it('lets a genuinely failed attempt be retried', () => {
    const key = deliveryKey(request());
    expect(isDuplicate(key, [record({ key, status: 'failed' })])).toBe(false);
  });

  // Distributing an amended report to someone who received the original is a NEW
  // disclosure and must not be suppressed.
  it('does not treat a new version as a duplicate', () => {
    const key = deliveryKey(request({ reportVersion: 2 }));
    expect(isDuplicate(key, [record({ key: deliveryKey(request()), status: 'read' })])).toBe(false);
  });
});

describe('distribution — an amendment makes every prior recipient wrong', () => {
  const history: DeliveryRecord[] = [
    record({ recipientId: 'pac-1', reportVersion: 1, status: 'read' }),
    record({ recipientId: 'med-1', reportVersion: 1, status: 'delivered' }),
    record({ recipientId: 'med-2', reportVersion: 2, status: 'read' }),
    record({ recipientId: 'med-3', reportVersion: 1, status: 'failed' }),
    record({ recipientId: 'med-4', reportVersion: 1, status: 'read', payload: 'notification' }),
  ];

  it('lists everyone holding an older version', () => {
    const superseded = supersededDeliveries(history, 'LAU-1', 2);
    expect(superseded.map(s => s.record.recipientId)).toEqual(['med-1', 'pac-1']);
  });

  it('leaves out failed deliveries — nobody is holding those', () => {
    expect(supersededDeliveries(history, 'LAU-1', 2).some(s => s.record.recipientId === 'med-3')).toBe(false);
  });

  it('leaves out notifications — they carried no content to be superseded', () => {
    expect(supersededDeliveries(history, 'LAU-1', 2).some(s => s.record.recipientId === 'med-4')).toBe(false);
  });

  it('takes the newest version each recipient received', () => {
    const withUpgrade = [...history, record({ recipientId: 'pac-1', reportVersion: 2, status: 'read' })];
    expect(supersededDeliveries(withUpgrade, 'LAU-1', 2).map(s => s.record.recipientId)).toEqual(['med-1']);
  });

  it('ignores other reports', () => {
    expect(supersededDeliveries(history, 'LAU-9', 2)).toEqual([]);
  });
});

describe('distribution — critical findings', () => {
  // Five sent emails and no read is not five-fifths of a communication.
  it('does not add sends up into a closed loop', () => {
    const status = criticalCommunication([
      record({ status: 'sent' }),
      record({ status: 'sent' }),
      record({ status: 'delivered' }),
    ]);
    expect(status.closed).toBe(false);
    expect(status.message).toMatch(/Enviado não é entregue e entregue não é lido/);
  });

  it('closes on a read', () => {
    const status = criticalCommunication([record({ status: 'sent' }), record({ status: 'read' })]);
    expect(status.closed).toBe(true);
  });

  it('closes on a recorded phone call', () => {
    const status = criticalCommunication([record({ status: 'sent', acknowledgedBy: 'Dr. Silva' })]);
    expect(status.message).toMatch(/Confirmado por Dr\. Silva/);
  });

  it('says when nothing was even attempted', () => {
    expect(criticalCommunication([]).message).toMatch(/Nenhuma tentativa/);
  });
});

describe('distribution — the readout', () => {
  it('names payload, version, channel and status', () => {
    expect(describeDelivery(record({ status: 'read' }))).toBe(
      'laudo v1 por e-mail: lido · ciclo fechado'
    );
  });

  it('summarises the plan', () => {
    const plan = planDistribution([request(), request({ channel: 'email' })], NOW);
    expect(plan.message).toBe('1 envio(s) liberado(s), 1 recusado(s).');
  });
});
