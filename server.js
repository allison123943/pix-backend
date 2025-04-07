// Importação de módulos necessários
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
    pass: 'hrirzodqitdzwvrb'
  }
});

const planos = {
  normal: 'Instrucoes_Assistente_Financeiro.pdf',
  casal: 'instrucoes_assistente_financeiro_plano_casal.pdf',
  familia: 'instrucoes_assistente_financeiro_plano_familia.pdf'
};

app.post('/webhook', async (req, res) => {
  try {
    const event = req.body;

    if (event.type === 'payment' && event.data?.id) {
      const paymentId = event.data.id;

      const paymentInfo = await mercadopago.payment.get(paymentId);

      if (paymentInfo.body.status === 'approved') {
        const email = paymentInfo.body.payer.email;
        const plano = paymentInfo.body.additional_info.items[0].title
          .replace('Plano ', '').toLowerCase();

        const nomeArquivoPDF = planos[plano];
        if (!nomeArquivoPDF) {
          throw new Error(`Plano '${plano}' não encontrado`);
        }

        const pdfPath = path.join(__dirname, nomeArquivoPDF);

        const mailOptions = {
          from: 'oficialfinanzap@gmail.com',
          to: email,
          subject: 'Seu PDF com instruções está aqui! 🎉',
          text: 'Obrigado por sua compra! Em anexo está o PDF com as instruções do seu plano.',
          attachments: [{
            filename: nomeArquivoPDF,
            path: pdfPath
          }]
        };

        await transporter.sendMail(mailOptions);
        res.status(200).send({ status: 'sucesso', message: 'Pagamento confirmado e PDF enviado.' });
      } else {
        res.status(200).send({ status: 'pendente', message: 'Pagamento recebido, porém não aprovado ainda.' });
      }
    } else {
      res.status(200).send({ status: 'sucesso', message: 'Evento não tratado recebido.' });
    }
  } catch (error) {
    res.status(500).send({ status: 'erro', message: 'Falha ao processar webhook', detalhes: error.message });
  }
});

app.post('/criar-pagamento', async (req, res) => {
  try {
    const { email, plano } = req.body;

    if (!email || !plano) {
      return res.status(400).json({ error: 'Dados incompletos: email e plano são obrigatórios' });
    }

    const valor = plano === 'normal' ? 1.00 : 1;
    const externalReference = uuidv4();

    const payment_data = {
      statement_descriptor: 'Finanzap',
      transaction_amount: parseFloat(valor.toFixed(2)),
      description: 'Finanzap',
      additional_info: {
        items: [{
          id: 'finanzap_001',
          title: `Plano ${plano}`,
          description: 'Acesso ao Assistente Financeiro',
          category_id: 'services',
          quantity: 1,
          unit_price: parseFloat(valor.toFixed(2))
        }]
      },
      payment_method_id: 'pix',
      notification_url: WEBHOOK_URL,
      external_reference: externalReference,
      payer: {
        email: email,
        first_name: 'Cliente',
        last_name: 'PIX',
        identification: { type: 'CPF', number: '12345678909' }
      }
    };

    const response = await mercadopago.payment.create(payment_data);

    res.json({
      paymentId: response.body.id,
      qrCode: response.body.point_of_interaction?.transaction_data?.qr_code,
      qrCodeBase64: response.body.point_of_interaction?.transaction_data?.qr_code_base64,
      status: response.body.status
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao criar pagamento', details: error.response?.data || error.message });
  }
});

app.get('/status-pagamento/:paymentId', async (req, res) => {
  try {
    const { paymentId } = req.params;
    const response = await mercadopago.payment.get(paymentId);
    res.json({ status: response.body.status });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao verificar pagamento', details: error.response?.data || error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});