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

mercadopago.configure({ access_token: ACCESS_TOKEN });

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'oficialfinanzap@gmail.com',
    pass: 'SUA_SENHA'
  }
});

const planos = {
   normal: 'instrucoesAssistenteFinanceiro.pdf',
    casal: 'instrucoesassistentefinanceiroplanocasal.pdf',
  familia: 'instrucoes_assistentefinanceiroplanofamilia.pdf'
};

function verifySignature(req, secret) {
  const signature = req.headers['x-mp-signature'] || '';
  const hash = crypto.createHmac('sha256', secret).update(JSON.stringify(req.body)).digest('hex');
  return signature === hash;
}

app.post('/webhook', async (req, res) => {
  if (!verifySignature(req, WEBHOOK_SECRET)) {
    return res.status(401).send({ error: 'Assinatura inválida' });
  }

  const event = req.body;

  if (event.type === 'payment' && event.data && event.data.id) {
    const paymentId = event.data.id;

    try {
      const paymentInfo = await mercadopago.payment.get(paymentId);

      if (paymentInfo.body.status === 'approved') {
        const email = paymentInfo.body.payer.email;
        const plano = paymentInfo.body.additional_info.items[0].title.split(' ')[1].toLowerCase();

        const mailOptions = {
          from: 'oficialfinanzap@gmail.com',
          to: email,
          subject: '📄 Seu PDF Finanzap',
          html: `<h1>Pagamento aprovado!</h1><p>Segue o PDF do seu plano <strong>${plano}</strong>.</p>`,
          attachments: [{
            filename: planos[plano],
            path: path.join(__dirname, planos[plano]),
            contentType: 'application/pdf'
          }]
        };

        await transporter.sendMail(mailOptions);

        res.status(200).send({ status: 'sucesso', message: 'Pagamento aprovado e e-mail enviado' });
      } else {
        res.status(200).send({ status: 'aguardando', message: 'Pagamento ainda não aprovado' });
      }
    } catch (error) {
      console.error('Erro:', error);
      res.status(500).send({ status: 'erro', message: error.message });
    }
  } else {
    res.status(200).send({ status: 'evento_ignorado', message: 'Evento não relacionado a pagamento' });
  }
});

app.post('/criar-pagamento', async (req, res) => {
  const { email, plano } = req.body;

  const externalReference = uuidv4();

  try {
    const response = await mercadopago.payment.create({
      transaction_amount: 1.00,
      description: `Plano ${plano}`,
      payment_method_id: 'pix',
      notification_url: WEBHOOK_URL,
      external_reference: externalReference,
      payer: { email }
    });

    res.json({
      paymentId: response.body.id,
      qrCode: response.body.point_of_interaction.transaction_data.qr_code,
      qrCodeBase64: response.body.point_of_interaction.transaction_data.qr_code_base64
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/status-pagamento/:paymentId', async (req, res) => {
  const { paymentId } = req.params;

  try {
    const response = await mercadopago.payment.get(paymentId);
    res.json({ status: response.body.status });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
