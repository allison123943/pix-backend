const express = require('express');
const cors = require('cors');
const axios = require('axios');
const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mercadopago = require('mercadopago');

const app = express();
app.use(cors());
app.use(express.json());

const ACCESS_TOKEN = 'APP_USR-2190858428063851-040509-f8899b0779b8753d85dae14f27892a0d-287816612';
const WEBHOOK_SECRET = '01d71aa758c6c87c2190438452b1dd6d52c06f2975fa56a221f6f324bbfa1482';
const WEBHOOK_URL = 'https://pix-backend-79lq.onrender.com/webhook';

// Configurando o Mercado Pago SDK
mercadopago.configure({ access_token: ACCESS_TOKEN });

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'oficialfinanzap@gmail.com',
    pass: 'irordtnnykrddujv'
  }
});

const planos = {
  normal: 'Instrucoes_Assistente_Financeiro.pdf',
  casal: 'instrucoes_assistente_financeiro_plano casal.pdf',
  familia: 'instrucoes_assistente_financeiro_plano familia.pdf'
};

function verifySignature(req, secret) {
  const signature = req.headers['x-mp-signature'] || '';
  const hash = crypto.createHmac('sha256', secret).update(JSON.stringify(req.body)).digest('hex');
  return signature === hash;
}

app.post('/webhook', (req, res) => {
  try {
    const event = req.body;
    console.log('Webhook recebido:', JSON.stringify(event, null, 2));

    if (event.type === 'payment' && (event.action === 'payment.updated' || event.data.status === 'approved')) {
      console.log('Pagamento atualizado/aprovado:', event.data.id);
      res.status(200).send('Pagamento recebido e processado');
    } else {
      console.log('Evento não tratado:', event.type, event.action);
      res.status(200).send('Evento recebido, mas não tratado');
    }
  } catch (error) {
    console.error('Erro ao processar webhook:', error.message);
    res.status(500).send('Erro no processamento do webhook');
  }
});

app.post('/criar-pagamento', async (req, res) => {
  try {
    const { email, plano } = req.body;

    if (!email || !plano) {
      return res.status(400).json({ error: 'Dados incompletos: email e plano são obrigatórios' });
    }

    const idempotencyKey = uuidv4();
    const valor = plano === 'normal' ? 27.50 : 1;
    const externalReference = uuidv4();

    const payment_data = {
      transaction_amount: parseFloat(valor.toFixed(2)),
      description: 'Finanzap',
      payment_method_id: 'pix',
      notification_url: WEBHOOK_URL,
      external_reference: externalReference,
      payer: {
        email: email,
        first_name: 'Cliente',
        last_name: 'PIX',
        identification: {
          type: 'CPF',
          number: '12345678909'
        }
      },
      additional_info: {
        items: [{
          id: 'finanzap_001',
          title: `Plano ${plano}`,
          description: 'Acesso ao Assistente Financeiro',
          category_id: 'services',
          quantity: 1,
          unit_price: parseFloat(valor.toFixed(2))
        }]
      }
    };

    const response = await mercadopago.payment.create(payment_data);

    if (response.body && response.body.id) {
      const planoArquivo = planos[plano] || planos.normal;
      const pdfPath = path.join(__dirname, planoArquivo);

      await transporter.sendMail({
        from: '"Assistente Financeiro" <oficialfinanzap@gmail.com>',
        to: email,
        subject: `Instruções de Pagamento - Plano ${plano}`,
        text: 'Obrigado pelo pagamento. Seguem as instruções em anexo.',
        attachments: [
          {
            filename: planoArquivo,
            path: pdfPath
          }
        ]
      });

      res.json({ paymentId: response.body.id, status: response.body.status });
    } else {
      console.error('Erro: Resposta inesperada do Mercado Pago:', response.body);
      res.status(500).json({ error: 'Erro ao criar pagamento: resposta inesperada do Mercado Pago', details: response.body });
    }
  } catch (error) {
    console.error('Erro ao criar pagamento:', error.response?.data || error.message);
    res.status(500).json({ error: 'Erro ao criar pagamento', details: error.response?.data || error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
