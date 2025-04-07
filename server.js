const express = require('express');
const cors = require('cors');
const axios = require('axios');
const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mercadopago = require('mercadopago');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

console.log('🚀 Inicializando servidor Finanzap...');
console.log('⚙️  Configurando middlewares: CORS e JSON parser...');

const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const WEBHOOK_SECRET = process.env.MP_WEBHOOK_SECRET;
const WEBHOOK_URL = 'https://pix-backend-79lq.onrender.com/webhook';

console.log('💳 Configurando Mercado Pago com access token...');
mercadopago.configure({ access_token: ACCESS_TOKEN });

console.log('📧 Configurando transporte de e-mail...');
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD
  }
});

transporter.verify((error, success) => {
  if (error) {
    console.error('❌ Falha na conexão com o serviço de e-mail:', error);
  } else {
    console.log('✅ Serviço de e-mail configurado com sucesso!');
  }
});

const planos = {
  normal: 'instrucoesAssistenteFinanceiro.pdf',
  casal: 'instrucoesassistentefinanceiroplanocasal.pdf',
  familia: 'instrucoes_assistentefinanceiroplanofamilia.pdf'
};

const precos = {
  normal: 27.50,
  casal: 48.00,
  familia: 55.00
};

console.log('📁 Planos e preços configurados:', JSON.stringify({ planos, precos }, null, 2));

const pagamentosAprovados = new Map();

async function enviarPDFPorEmail(email, plano) {
  console.log(`\n📨 Iniciando envio de e-mail para ${email} (Plano: ${plano})`);
  
  try {
    if (!planos[plano]) {
      throw new Error(`Plano '${plano}' não encontrado`);
    }

    const pdfPath = path.join(__dirname, planos[plano]);
    console.log(`📁 Verificando arquivo em: ${pdfPath}`);

    if (!fs.existsSync(pdfPath)) {
      throw new Error(`Arquivo PDF não encontrado: ${pdfPath}`);
    }

    console.log('✉️  Preparando e-mail...');
    const mailOptions = {
      from: 'Finanzap <oficialfinanzap@gmail.com>',
      to: email,
      subject: '📚 Seu Material Finanzap - Acesso ao Conteúdo',
      html: `<div style="font-family: Arial, sans-serif; color: #333;">
              <h1 style="color: #2c3e50;">Seu material está pronto!</h1>
              <p>Obrigado por adquirir o plano <strong>${plano}</strong> do Finanzap!</p>
              <p>Segue em anexo o material completo.</p>
              <p style="margin-top: 30px; font-size: 0.9em; color: #7f8c8d;">
                Atenciosamente,<br>Equipe Finanzap
              </p>
            </div>`,
      attachments: [{
        filename: `Finanzap_${plano}.pdf`,
        path: pdfPath,
        contentType: 'application/pdf'
      }]
    };

    console.log('⚡ Enviando e-mail...');
    const info = await transporter.sendMail(mailOptions);
    console.log('✅ E-mail enviado com sucesso! ID:', info.messageId);
    return info;

  } catch (error) {
    console.error('❌ Erro no envio do e-mail:', error.message);
    throw error;
  }
}

function verifySignature(req, secret) {
  console.log('🔒 Verificando assinatura do webhook...');
  const signature = req.headers['x-mp-signature'] || '';
  const hash = crypto.createHmac('sha256', secret).update(JSON.stringify(req.body)).digest('hex');
  const isValid = signature === hash;
  console.log(`🔑 Assinatura ${isValid ? 'válida' : 'inválida'}`);
  return isValid;
}

app.post('/webhook', async (req, res) => {
  console.log('\n--- 🎉 NOVA REQUISIÇÃO DE WEBHOOK RECEBIDA ---');
  
  if (!verifySignature(req, WEBHOOK_SECRET)) {
    console.error('🚨 Erro: Assinatura de webhook inválida');
    return res.status(401).send({ error: 'Assinatura inválida' });
  }

  const event = req.body;

  if (event.type === 'payment' && event.data?.id) {
    const paymentId = event.data.id;
    console.log(`📥 Processando pagamento ID: ${paymentId}`);

    try {
      const paymentInfo = await mercadopago.payment.get(paymentId);
      console.log('ℹ️ Status do pagamento:', paymentInfo.body.status);

      if (paymentInfo.body.status === 'approved') {
        const plano = paymentInfo.body.additional_info.items[0].title.split(' ')[1].toLowerCase();
        
        pagamentosAprovados.set(paymentId, {
          plano,
          dataAprovacao: new Date(),
          email: paymentInfo.body.payer.email
        });
        
        console.log('✅ Pagamento aprovado. Aguardando confirmação de e-mail');
        res.status(200).send({ 
          status: 'sucesso', 
          message: 'Pagamento aprovado - Aguardando confirmação de e-mail',
          paymentId
        });
      } else {
        res.status(200).send({ 
          status: paymentInfo.body.status,
          message: 'Pagamento ainda não aprovado' 
        });
      }
    } catch (error) {
      console.error('🔥 Erro ao processar pagamento:', error);
      res.status(500).send({ 
        status: 'erro', 
        message: error.message 
      });
    }
  } else {
    res.status(200).send({ 
      status: 'evento_ignorado', 
      message: 'Evento não relacionado a pagamento' 
    });
  }
});

app.post('/criar-pagamento', async (req, res) => {
  console.log('\n--- 💰 NOVA SOLICITAÇÃO DE PAGAMENTO ---');
  const { email, plano } = req.body;
  console.log(`📧 Cliente: ${email} | Plano: ${plano}`);

  if (!precos[plano]) {
    console.error('❌ Plano inválido:', plano);
    return res.status(400).json({ error: 'Plano inválido' });
  }

  const externalReference = uuidv4();
  console.log('🔗 External Reference gerado:', externalReference);

  try {
    const valorPlano = precos[plano];
    console.log(`💰 Valor do Plano (${plano}): R$ ${valorPlano.toFixed(2)}`);

    const response = await mercadopago.payment.create({
      transaction_amount: valorPlano,
      description: `Plano ${plano}`,
      payment_method_id: 'pix',
      notification_url: WEBHOOK_URL,
      external_reference: externalReference,
      payer: { email },
      additional_info: {
        items: [{
          title: `Plano ${plano}`,
          quantity: 1,
          unit_price: valorPlano
        }]
      }
    });

    console.log('✅ Pagamento criado com sucesso. ID:', response.body.id);
    res.json({
      paymentId: response.body.id,
      qrCode: response.body.point_of_interaction.transaction_data.qr_code,
      qrCodeBase64: response.body.point_of_interaction.transaction_data.qr_code_base64,
      externalReference
    });

  } catch (error) {
    console.error('❌ Erro ao criar pagamento:', error);
    res.status(500).json({ 
      error: error.message,
      details: error.response?.data 
    });
  }
});

app.get('/status-pagamento/:paymentId', async (req, res) => {
  const { paymentId } = req.params;
  console.log(`\n🔍 Consultando status do pagamento ID: ${paymentId}`);

  try {
    const response = await mercadopago.payment.get(paymentId);
    res.json({ 
      status: response.body.status,
      last_update: response.body.date_last_updated
    });
  } catch (error) {
    console.error('❌ Erro ao consultar status:', error);
    res.status(500).json({ 
      error: error.message,
      paymentId 
    });
  }
});

app.get('/verificar-aprovacao/:paymentId', async (req, res) => {
  const { paymentId } = req.params;
  console.log(`\n🔍 Verificando aprovação para pagamento ID: ${paymentId}`);

  try {
    if (pagamentosAprovados.has(paymentId)) {
      return res.json({ 
        aprovado: true,
        requerEmail: true
      });
    }

    const paymentInfo = await mercadopago.payment.get(paymentId);
    const aprovado = paymentInfo.body.status === 'approved';

    if (aprovado) {
      const plano = paymentInfo.body.additional_info.items[0].title.split(' ')[1].toLowerCase();
      pagamentosAprovados.set(paymentId, {
        plano,
        dataAprovacao: new Date(),
        email: paymentInfo.body.payer.email
      });
    }

    res.json({ 
      aprovado,
      requerEmail: aprovado
    });

  } catch (error) {
    console.error('❌ Erro ao verificar aprovação:', error);
    res.status(500).json({ 
      error: error.message 
    });
  }
});

app.post('/confirmar-email', async (req, res) => {
  console.log('\n--- 📩 CONFIRMAÇÃO DE E-MAIL RECEBIDA ---');
  const { paymentId, email } = req.body;
  console.log(`📨 Dados: paymentId=${paymentId}, email=${email}`);

  try {
    if (!pagamentosAprovados.has(paymentId)) {
      console.log('⚠️ Pagamento não encontrado na memória. Verificando no Mercado Pago...');
      const paymentInfo = await mercadopago.payment.get(paymentId);
      
      if (paymentInfo.body.status !== 'approved') {
        throw new Error('Pagamento não aprovado');
      }

      const plano = paymentInfo.body.additional_info.items[0].title.split(' ')[1].toLowerCase();
      pagamentosAprovados.set(paymentId, {
        plano,
        dataAprovacao: new Date(),
        email: paymentInfo.body.payer.email
      });
    }

    const { plano } = pagamentosAprovados.get(paymentId);
    console.log(`📤 Enviando PDF do plano ${plano} para: ${email}`);

    await enviarPDFPorEmail(email, plano);

    pagamentosAprovados.delete(paymentId);

    res.json({ 
      success: true,
      message: `PDF enviado com sucesso para ${email}`
    });

  } catch (error) {
    console.error('❌ Falha na confirmação de e-mail:', error);
    res.status(400).json({ 
      success: false,
      message: error.message
    });
  }
});

app.get('/testar-email/:email/:plano', async (req, res) => {
  console.log('\n--- ✉️  TESTE DE ENVIO DE E-MAIL ---');
  const { email, plano } = req.params;
  
  try {
    const info = await enviarPDFPorEmail(email, plano);
    res.json({ 
      success: true,
      messageId: info.messageId 
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('\n========================================');
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`🌐 Webhook configurado para: ${WEBHOOK_URL}`);
  console.log('🛠️  Pronto para receber requisições');
  console.log('========================================\n');
});