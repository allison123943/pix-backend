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

console.log('Inicializando servidor...');
console.log('Configurando middlewares: CORS e JSON parser...');

const ACCESS_TOKEN = 'APP_USR-2190858428063851-040509-f8899b0779b8753d85dae14f27892a0d-287816612';
const WEBHOOK_SECRET = '01d71aa758c6c87c2190438452b1dd6d52c06f2975fa56a221f6f324bbfa1482';
const WEBHOOK_URL = 'https://pix-backend-79lq.onrender.com/webhook';

console.log('Configurando Mercado Pago com access token...');
mercadopago.configure({ access_token: ACCESS_TOKEN });

console.log('Configurando transporte de e-mail...');
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

console.log('Planos disponíveis configurados:', Object.keys(planos));

function verifySignature(req, secret) {
  console.log('Verificando assinatura do webhook...');
  const signature = req.headers['x-mp-signature'] || '';
  const hash = crypto.createHmac('sha256', secret).update(JSON.stringify(req.body)).digest('hex');
  const isValid = signature === hash;
  console.log(`Assinatura ${isValid ? 'válida' : 'inválida'}`);
  return isValid;
}

app.post('/webhook', async (req, res) => {
  console.log('\n--- NOVA REQUISIÇÃO DE WEBHOOK RECEBIDA ---');
  console.log('Tipo de evento:', req.body.type);
  
  if (!verifySignature(req, WEBHOOK_SECRET)) {
    console.error('Erro: Assinatura de webhook inválida. Retornando 401.');
    return res.status(401).send({ error: 'Assinatura inválida' });
  }

  const event = req.body;
  console.log('Evento recebido:', JSON.stringify(event, null, 2));

  if (event.type === 'payment' && event.data && event.data.id) {
    const paymentId = event.data.id;
    console.log(`Processando pagamento ID: ${paymentId}`);

    try {
      console.log('Buscando informações do pagamento no Mercado Pago...');
      const paymentInfo = await mercadopago.payment.get(paymentId);
      console.log('Status do pagamento:', paymentInfo.body.status);

      if (paymentInfo.body.status === 'approved') {
        const email = paymentInfo.body.payer.email;
        const plano = paymentInfo.body.additional_info.items[0].title.split(' ')[1].toLowerCase();
        console.log(`Pagamento aprovado para e-mail: ${email}, plano: ${plano}`);

        const mailOptions = {
          from: 'oficialfinanzap@gmail.com',
          to: email,
          subject: '📕 Seu PDF Finanzap',
          html: `<h1>Pagamento aprovado!</h1><p>Segue o PDF do seu plano <strong>${plano}</strong>.</p>`,
          attachments: [{
            filename: planos[plano],
            path: path.join(__dirname, planos[plano]),
            contentType: 'application/pdf'
          }]
        };

        console.log('Preparando envio de e-mail...');
        await transporter.sendMail(mailOptions);
        console.log('E-mail enviado com sucesso!');

        res.status(200).send({ status: 'sucesso', message: 'Pagamento aprovado e e-mail enviado' });
      } else {
        console.log('Pagamento ainda não aprovado. Status:', paymentInfo.body.status);
        res.status(200).send({ status: 'aguardando', message: 'Pagamento ainda não aprovado' });
      }
    } catch (error) {
      console.error('Erro ao processar pagamento:', error.message);
      console.error('Stack trace:', error.stack);
      res.status(500).send({ status: 'erro', message: error.message });
    }
  } else {
    console.log('Evento ignorado - não relacionado a pagamento');
    res.status(200).send({ status: 'evento_ignorado', message: 'Evento não relacionado a pagamento' });
  }
});

app.post('/criar-pagamento', async (req, res) => {
  console.log('\n--- NOVA REQUISIÇÃO PARA CRIAR PAGAMENTO ---');
  const { email, plano } = req.body;
  console.log(`Solicitação de pagamento recebida - Email: ${email}, Plano: ${plano}`);

  const externalReference = uuidv4();
  console.log('Gerado externalReference:', externalReference);

  try {
    console.log('Criando pagamento no Mercado Pago...');
    const response = await mercadopago.payment.create({
      transaction_amount: 1.00,
      description: `Plano ${plano}`,
      payment_method_id: 'pix',
      notification_url: WEBHOOK_URL,
      external_reference: externalReference,
      payer: { email }
    });

    console.log('Pagamento criado com sucesso. ID:', response.body.id);
    res.json({
      paymentId: response.body.id,
      qrCode: response.body.point_of_interaction.transaction_data.qr_code,
      qrCodeBase64: response.body.point_of_interaction.transaction_data.qr_code_base64
    });
  } catch (error) {
    console.error('Erro ao criar pagamento:', error.message);
    console.error('Stack trace:', error.stack);
    res.status(500).json({ error: error.message });
  }
});

app.get('/status-pagamento/:paymentId', async (req, res) => {
  console.log('\n--- CONSULTA DE STATUS DE PAGAMENTO ---');
  const { paymentId } = req.params;
  console.log('Consultando status para paymentId:', paymentId);

  try {
    console.log('Buscando informações do pagamento...');
    const response = await mercadopago.payment.get(paymentId);
    console.log('Status encontrado:', response.body.status);
    res.json({ status: response.body.status });
  } catch (error) {
    console.error('Erro ao consultar status:', error.message);
    console.error('Stack trace:', error.stack);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n=== SERVIDOR INICIADO COM SUCESSO ===`);
  console.log(`Servidor rodando na porta ${PORT}`);
  console.log(`Webhook configurado para: ${WEBHOOK_URL}`);
  console.log('Pronto para receber requisições!\n');
});
