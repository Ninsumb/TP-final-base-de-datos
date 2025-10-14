import express from 'express';
import cors from 'cors';
// Cargar variables de entorno desde backend/.env en desarrollo
import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

import { connectToDatabase, closeDatabaseConnection, getDb } from './db';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.send('API TP Final Base de Datos funcionando');
});

// Ruta para chat general
app.post('/api/chat', async (req, res) => {
  const { query } = req.body;
  if (!query) {
    return res.status(400).json({ error: 'Query is required' });
  }

  // Manejar comando especial /analiza {nombre}
  // Soporte de comandos que empiezan con '/'
  if (query.startsWith('/')) {
    const parts = query.trim().split(/\s+/);
    const command = parts[0].toLowerCase();
    const db = getDb();

    try {
      switch (command) {
        case '/help': {
          const helpText = `Comandos disponibles:\n
/help - Mostrar esta ayuda\n+/create {name} - Crear un nuevo análisis con el campo name\n+/list - Listar los análisis guardados (últimos 50)\n+/get {id|name} - Obtener un análisis por _id o por name\n+/update {id} {newName} - Actualizar el campo name de un análisis por _id\n+/delete {id|name} - Eliminar un análisis por _id o por name\n`;
          return res.json({ response: helpText });
        }

        case '/create': {
          const name = parts.slice(1).join(' ').trim();
          if (!name) return res.status(400).json({ error: 'Uso: /create {name}' });
          const result = await db.collection('analysis').insertOne({ name, created_at: new Date() });
          return res.json({ response: `Creado con _id=${result.insertedId} nombre=${name}` });
        }

        case '/list': {
          const docs = await db.collection('analysis').find().sort({ created_at: -1 }).limit(50).toArray();
          return res.json({ response: docs });
        }

        case '/get': {
          const key = parts.slice(1).join(' ').trim();
          if (!key) return res.status(400).json({ error: 'Uso: /get {id|name}' });
          let doc = null;
          const { ObjectId } = require('mongodb');
          if (ObjectId.isValid(key)) {
            doc = await db.collection('analysis').findOne({ _id: new ObjectId(key) });
          }
          if (!doc) {
            doc = await db.collection('analysis').findOne({ name: key });
          }
          if (!doc) return res.status(404).json({ error: 'No encontrado' });
          return res.json({ response: doc });
        }

        case '/update': {
          const id = parts[1];
          const newName = parts.slice(2).join(' ').trim();
          if (!id || !newName) return res.status(400).json({ error: 'Uso: /update {id} {newName}' });
          const { ObjectId } = require('mongodb');
          if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'ID inválido' });
          const result = await db.collection('analysis').updateOne({ _id: new ObjectId(id) }, { $set: { name: newName } });
          if (result.matchedCount === 0) return res.status(404).json({ error: 'No encontrado' });
          return res.json({ response: `Actualizado _id=${id} nombre=${newName}` });
        }

        case '/delete': {
          const key = parts.slice(1).join(' ').trim();
          if (!key) return res.status(400).json({ error: 'Uso: /delete {id|name}' });
          const { ObjectId } = require('mongodb');
          let result = null;
          if (ObjectId.isValid(key)) {
            result = await db.collection('analysis').deleteOne({ _id: new ObjectId(key) });
          } else {
            result = await db.collection('analysis').deleteMany({ name: key });
          }
          if (result.deletedCount === 0) return res.status(404).json({ error: 'No encontrado' });
          return res.json({ response: `Eliminado(s): ${result.deletedCount}` });
        }

        default:
          return res.status(400).json({ error: 'Comando desconocido. Usa /help para ver los comandos disponibles' });
      }
    } catch (err) {
      console.error('Error manejando comando:', err);
      return res.status(500).json({ error: 'Error interno al procesar el comando' });
    }
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'deepseek/deepseek-chat-v3.1:free',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant.'
          },
          {
            role: 'user',
            content: query
          }
        ]
      })
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: data });
    }

    const responseText = data.choices[0].message.content;
    res.json({ response: responseText });
  } catch (error) {
    console.error('Error calling OpenRouter:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ...aquí irán rutas para consultas, ingestión, reportes, etc.

// Endpoints REST CRUD para la colección `analysis`
const analysisRouter = express.Router();

// Listar (últimos 100)
analysisRouter.get('/', async (req, res) => {
  try {
    const db = getDb();
    const docs = await db.collection('analysis').find().sort({ created_at: -1 }).limit(100).toArray();
    res.json({ data: docs });
  } catch (err) {
    console.error('Error listando analysis:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// Crear
analysisRouter.post('/', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name es requerido' });
  try {
    const db = getDb();
    const result = await db.collection('analysis').insertOne({ name, created_at: new Date() });
    res.status(201).json({ insertedId: result.insertedId });
  } catch (err) {
    console.error('Error creando analysis:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// Obtener por id
analysisRouter.get('/:id', async (req, res) => {
  const id = req.params.id;
  const { ObjectId } = require('mongodb');
  if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'ID inválido' });
  try {
    const db = getDb();
    const doc = await db.collection('analysis').findOne({ _id: new ObjectId(id) });
    if (!doc) return res.status(404).json({ error: 'No encontrado' });
    res.json({ data: doc });
  } catch (err) {
    console.error('Error obteniendo analysis:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// Actualizar por id
analysisRouter.put('/:id', async (req, res) => {
  const id = req.params.id;
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name es requerido' });
  const { ObjectId } = require('mongodb');
  if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'ID inválido' });
  try {
    const db = getDb();
    const result = await db.collection('analysis').updateOne({ _id: new ObjectId(id) }, { $set: { name } });
    if (result.matchedCount === 0) return res.status(404).json({ error: 'No encontrado' });
    res.json({ updatedCount: result.modifiedCount });
  } catch (err) {
    console.error('Error actualizando analysis:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// Eliminar por id
analysisRouter.delete('/:id', async (req, res) => {
  const id = req.params.id;
  const { ObjectId } = require('mongodb');
  if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'ID inválido' });
  try {
    const db = getDb();
    const result = await db.collection('analysis').deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount === 0) return res.status(404).json({ error: 'No encontrado' });
    res.json({ deletedCount: result.deletedCount });
  } catch (err) {
    console.error('Error eliminando analysis:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

app.use('/api/analysis', analysisRouter);

const PORT = Number(process.env.PORT) || 3001;

async function startServer() {
  try {
    // Conectar a la base de datos (usa MONGODB_URI en backend/.env)
    await connectToDatabase();

    app.listen(PORT, () => {
      console.log(`Backend escuchando en puerto ${PORT}`);
    });
  } catch (err) {
    console.error('Error iniciando servidor:', err);
    process.exit(1);
  }
}

startServer();

// Manejar cierre gracioso
process.on('SIGINT', async () => {
  console.log('Recibido SIGINT, cerrando...');
  await closeDatabaseConnection();
  process.exit(0);
});
process.on('SIGTERM', async () => {
  console.log('Recibido SIGTERM, cerrando...');
  await closeDatabaseConnection();
  process.exit(0);
});
